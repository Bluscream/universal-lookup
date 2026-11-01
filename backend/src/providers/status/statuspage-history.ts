import type { StatusHistoryPoint } from '../../types/common.js';
import { statusGet } from './http.js';

/**
 * Daily uptime history for Atlassian Statuspage pages.
 *
 * `summary.json` only carries the current state. Two other sources hold history:
 *
 * 1. `/uptime_showcase?components=a,b` — the (undocumented) endpoint behind the
 *    90-day bars on the public page. Per component it returns daily outage
 *    seconds (`m` = major, `p` = partial) and precomputed 30/60/90-day uptime.
 *    Only components flagged `showcase` have data; pages that hide the bars
 *    return nothing.
 * 2. `/api/v2/incidents.json` — the 50 most recent incidents. Used as a fallback,
 *    restricted to the span those incidents actually cover.
 *
 * The page-level series is the worst component per day, matching how the page
 * itself colours an outage.
 */

export interface StatuspageHistory {
  history: StatusHistoryPoint[];
  uptime30d: number | null;
  uptime90d: number | null;
}

interface SummaryComponent {
  id?: string;
  group?: boolean;
  showcase?: boolean;
}

interface ShowcaseDay {
  date?: string;
  outages?: { m?: number; p?: number };
}

interface ShowcaseResponse {
  timelines?: Record<string, { days?: ShowcaseDay[] }>;
  values?: Array<{ thirty?: number; ninety?: number }>;
}

interface HistoryIncident {
  impact?: string | null;
  created_at?: string | null;
  started_at?: string | null;
  updated_at?: string | null;
  resolved_at?: string | null;
  status?: string | null;
}

const DAY_SECONDS = 86_400;
/** Statuspage counts partial outages at 30% weight in its uptime bars. */
const PARTIAL_WEIGHT = 0.3;
/** The public page requests at most 60 components per call. */
const BATCH_LIMIT = 60;
const HISTORY_DAYS = 90;
/** History moves slowly; refreshing it hourly keeps the extra requests negligible. */
const TTL_MS = 60 * 60 * 1000;
/**
 * How long past its last update an unresolved incident is assumed to last.
 * Pages often leave incidents in "monitoring" for weeks after the fault is
 * gone; without a cap one stale post would zero out every day since.
 */
const STALE_OPEN_MS = 24 * 60 * 60 * 1000;
/**
 * Incidents open longer than this are long-tail notices (e.g. a weeks-long
 * "wrong geolocation for some users"), not outages, and are left out.
 */
const MAX_INCIDENT_MS = 7 * 24 * 60 * 60 * 1000;

const cache = new Map<string, { at: number; value: StatuspageHistory }>();

export function clearStatuspageHistoryCache(): void {
  cache.clear();
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function point(date: string, ratio: number): StatusHistoryPoint {
  const r = round3(Math.max(0, Math.min(100, ratio)));
  return { date, ratio: r, label: r >= 100 ? 'excellent' : r >= 99 ? 'good' : 'degraded' };
}

function average(points: StatusHistoryPoint[], days: number): number | null {
  const slice = points.slice(-days);
  if (slice.length === 0) return null;
  return round3(slice.reduce((a, p) => a + p.ratio, 0) / slice.length);
}

/** `https://x/api/v2/summary.json` -> `https://x`. */
export function pageOrigin(summaryUrl: string): string {
  return summaryUrl.replace(/\/api\/v2\/summary\.json$/, '');
}

/** Worst-component-per-day series from an `uptime_showcase` response. */
export function showcaseToHistory(body: ShowcaseResponse): StatuspageHistory {
  const worst = new Map<string, number>();
  for (const timeline of Object.values(body.timelines || {})) {
    for (const day of timeline.days || []) {
      if (!day.date) continue;
      const down = (day.outages?.m || 0) + PARTIAL_WEIGHT * (day.outages?.p || 0);
      const ratio = 100 - (Math.min(down, DAY_SECONDS) / DAY_SECONDS) * 100;
      worst.set(day.date, Math.min(worst.get(day.date) ?? 100, ratio));
    }
  }
  const history = [...worst.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, ratio]) => point(date, ratio));

  // The page's own aggregate figures are per component; take the worst too.
  const values = body.values || [];
  const pick = (k: 'thirty' | 'ninety') => {
    const v = values.map((x) => x[k]).filter((n): n is number => typeof n === 'number');
    return v.length > 0 ? Math.min(...v) : null;
  };
  return {
    history,
    uptime30d: pick('thirty') ?? average(history, 30),
    uptime90d: pick('ninety') ?? average(history, 90),
  };
}

function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function incidentEnd(inc: HistoryIncident, start: number, now: number): number {
  const resolved = Date.parse(inc.resolved_at || '');
  if (!Number.isNaN(resolved)) return resolved;
  const updated = Date.parse(inc.updated_at || '');
  const last = Number.isNaN(updated) ? start : updated;
  const status = (inc.status || '').toLowerCase();
  if (status === 'resolved' || status === 'postmortem' || status === 'completed') return last;
  return Math.min(now, last + STALE_OPEN_MS);
}

/** Milliseconds within [from, to) covered by at least one span. */
function clippedUnion(
  spans: Array<{ start: number; end: number }>,
  from: number,
  to: number,
): number {
  const parts = spans
    .map((s) => [Math.max(s.start, from), Math.min(s.end, to)] as const)
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);
  let total = 0;
  let curStart = -1;
  let curEnd = -1;
  for (const [a, b] of parts) {
    if (a > curEnd) {
      total += curEnd - curStart;
      curStart = a;
      curEnd = b;
    } else curEnd = Math.max(curEnd, b);
  }
  return total + (curEnd - curStart);
}

/**
 * Approximate daily uptime from recent incidents. Days before the oldest
 * returned incident are unknown (the feed is capped at 50), so they are left
 * out rather than reported as 100%.
 */
export function incidentsToHistory(
  incidents: HistoryIncident[],
  now: number = Date.now(),
): StatuspageHistory {
  const today = Date.parse(`${isoDay(now)}T00:00:00Z`);
  let from = today - (HISTORY_DAYS - 1) * DAY_SECONDS * 1000;

  const spans: Array<{ start: number; end: number; weight: number }> = [];
  let oldest = Number.POSITIVE_INFINITY;
  for (const inc of incidents) {
    const start = Date.parse(inc.started_at || inc.created_at || '');
    if (Number.isNaN(start)) continue;
    oldest = Math.min(oldest, start);
    const impact = (inc.impact || '').toLowerCase();
    const weight =
      impact === 'major' || impact === 'critical' ? 1 : impact === 'minor' ? PARTIAL_WEIGHT : 0;
    if (weight === 0) continue;
    const end = incidentEnd(inc, start, now);
    if (end - start > MAX_INCIDENT_MS) continue;
    spans.push({ start, end, weight });
  }
  // A full feed means older incidents were cut off; only trust the covered span.
  if (incidents.length >= 50 && Number.isFinite(oldest)) {
    from = Math.max(from, Date.parse(`${isoDay(oldest)}T00:00:00Z`));
  }

  const history: StatusHistoryPoint[] = [];
  for (let day = from; day <= today; day += DAY_SECONDS * 1000) {
    const dayEnd = Math.min(day + DAY_SECONDS * 1000, now);
    const major = clippedUnion(
      spans.filter((s) => s.weight === 1),
      day,
      dayEnd,
    );
    const any = clippedUnion(spans, day, dayEnd);
    // Overlapping incidents count once; major time outranks partial time.
    const down = (major + PARTIAL_WEIGHT * (any - major)) / 1000;
    const length = (dayEnd - day) / 1000;
    history.push(
      point(isoDay(day), length > 0 ? 100 - (Math.min(down, length) / length) * 100 : 100),
    );
  }
  return { history, uptime30d: average(history, 30), uptime90d: average(history, 90) };
}

async function fetchShowcase(
  origin: string,
  components: unknown[],
): Promise<StatuspageHistory | null> {
  const codes = (components as SummaryComponent[])
    .filter((c) => c.showcase && !c.group && c.id)
    .map((c) => c.id as string);
  if (codes.length === 0) return null;

  const merged: ShowcaseResponse = { timelines: {}, values: [] };
  for (let i = 0; i < codes.length; i += BATCH_LIMIT) {
    const batch = codes.slice(i, i + BATCH_LIMIT);
    const resp = await statusGet<ShowcaseResponse>(
      `${origin}/uptime_showcase?components=${encodeURIComponent(batch.join(','))}`,
      { headers: { Accept: 'application/json' } },
    );
    Object.assign(merged.timelines as object, resp.data?.timelines || {});
    merged.values?.push(...(resp.data?.values || []));
  }
  const result = showcaseToHistory(merged);
  return result.history.length > 0 ? result : null;
}

async function fetchIncidents(origin: string): Promise<StatuspageHistory | null> {
  const resp = await statusGet<{ incidents?: HistoryIncident[] }>(
    `${origin}/api/v2/incidents.json`,
  );
  const incidents = resp.data?.incidents;
  if (!Array.isArray(incidents)) return null;
  const result = incidentsToHistory(incidents);
  return result.history.length > 0 ? result : null;
}

/**
 * Daily history for a Statuspage page, or null if neither source is usable.
 * Never throws: history is decoration and must not fail the status lookup.
 */
export async function getStatuspageHistory(
  summaryUrl: string,
  components: unknown[] = [],
): Promise<StatuspageHistory | null> {
  const hit = cache.get(summaryUrl);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  const origin = pageOrigin(summaryUrl);
  let value: StatuspageHistory | null = null;
  try {
    value = await fetchShowcase(origin, components);
  } catch {
    // Endpoint missing on this page (404) — fall through to incidents.
  }
  if (!value) {
    try {
      value = await fetchIncidents(origin);
    } catch {
      value = null;
    }
  }
  if (value) cache.set(summaryUrl, { at: Date.now(), value });
  else if (hit) return hit.value;
  return value;
}
