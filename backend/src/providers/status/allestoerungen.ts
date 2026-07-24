import { config } from '../../config.js';
import type {
  LookupType,
  Provider,
  ProviderResult,
  StatusData,
  StatusIndicator,
} from '../../types/common.js';
import type { StatusEnricher, StatusEnrichment } from './enrich.js';
import { statusGet } from './http.js';
import {
  type StatuspageSummary,
  statusTextForIndicator,
  summaryToStatusData,
} from './statuspage.js';

/**
 * allestörungen.de (and its Downdetector sibling locales) — crowd-sourced outage
 * detection.
 *
 * Unlike every other provider here this is not an operator-published feed: it
 * aggregates user problem reports, so it flags an outage minutes before the
 * vendor's own status page admits one, and it covers services that publish no
 * status page at all (games, banks, ISPs).
 *
 * There is no public API — the site is a Next.js app that server-renders its
 * GraphQL result into the RSC flight payload, so we recover the very object the
 * page renders from. See {@link extractCompany}.
 */

/** Cap on how much HTML we'll pull for one page (they run ~110 KB). */
const PAGE_SIZE_LIMIT = 8 * 1024 * 1024;

/** Where the site serves the company logos referenced by `company.logo`. */
const LOGO_BASE = 'https://cdn2.downdetector.com/static/uploads/';

export interface AllestoerungenDataPoint {
  timestampUtc?: string;
  reportsValue?: number;
  baselineValue?: number;
}

export interface AllestoerungenCompany {
  id?: string;
  name?: string;
  slug?: string;
  logo?: string;
  website?: string;
  category?: { name?: string; slug?: string };
  contact?: { statusUrl?: string | null };
  stats?: {
    /** The traffic-light status the site shows: success | warning | danger. */
    status?: string;
    /** Full 15-minute series, present on a service's own status page. */
    chartData?: { dataPoints?: AllestoerungenDataPoint[] };
    /** Bare report counts with no timestamps, as listed on the homepage. */
    sparkline?: number[];
  };
}

/* -------------------------------------------------------------------------- */
/* Parsing                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Scan from `start` (which must index a `{`) to just past the matching `}`,
 * honouring string literals and escapes.
 */
function matchBraces(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === '\\') i++;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

/**
 * Decode the React Server Components flight payload from a Next.js page. The
 * data arrives as a series of `self.__next_f.push([1,"<js-string>"])` calls
 * whose concatenated contents hold the serialized component tree.
 */
export function extractFlightPayload(html: string): string {
  const parts: string[] = [];
  const re = /self\.__next_f\.push\(\[1,\s*("(?:[^"\\]|\\.)*")\]\)/g;
  let m: RegExpExecArray | null = re.exec(html);
  while (m !== null) {
    try {
      parts.push(JSON.parse(m[1]) as string);
    } catch {
      // One malformed chunk shouldn't discard the rest of the payload.
    }
    m = re.exec(html);
  }
  return parts.join('');
}

/**
 * Every `CompanyType` object embedded in a page, keyed by slug. The homepage
 * carries ~50 of them (its "most reported" board), which is how a single request
 * can answer for many services at once.
 */
export function extractCompanies(html: string): Map<string, AllestoerungenCompany> {
  const payload = html.includes('__next_f') ? extractFlightPayload(html) : html;
  const marker = '{"__typename":"CompanyType"';
  const found = new Map<string, AllestoerungenCompany>();

  let idx = payload.indexOf(marker);
  while (idx !== -1) {
    const end = matchBraces(payload, idx);
    if (end > idx) {
      try {
        const obj = JSON.parse(payload.slice(idx, end)) as AllestoerungenCompany;
        if (obj?.slug && obj.stats?.status) {
          const existing = found.get(obj.slug);
          // Keep the richer record if a company appears more than once.
          if (!existing || (!existing.stats?.chartData && obj.stats?.chartData)) {
            found.set(obj.slug, obj);
          }
        }
      } catch {
        // Not a company object; keep scanning.
      }
    }
    idx = payload.indexOf(marker, idx + marker.length);
  }
  return found;
}

/**
 * Pull the `CompanyType` object carrying live stats out of a status page.
 * Several such objects appear (trending lists, related services); the page's own
 * subject is the one with chart data.
 */
export function extractCompany(html: string): AllestoerungenCompany | null {
  const payload = html.includes('__next_f') ? extractFlightPayload(html) : html;
  const marker = '{"__typename":"CompanyType"';
  let fallback: AllestoerungenCompany | null = null;

  let idx = payload.indexOf(marker);
  while (idx !== -1) {
    const end = matchBraces(payload, idx);
    if (end > idx) {
      try {
        const obj = JSON.parse(payload.slice(idx, end)) as AllestoerungenCompany;
        if (obj?.stats?.chartData?.dataPoints?.length) return obj;
        if (!fallback && obj?.stats?.status) fallback = obj;
      } catch {
        // Not the object we're after; keep scanning.
      }
    }
    idx = payload.indexOf(marker, idx + marker.length);
  }
  return fallback;
}

/* -------------------------------------------------------------------------- */
/* Mapping                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The report series, newest last. Prefers the timestamped chart from a status
 * page and falls back to the homepage's bare sparkline (counts only, so no
 * baseline and no timestamps).
 */
function usablePoints(company: AllestoerungenCompany): AllestoerungenDataPoint[] {
  const points = (company.stats?.chartData?.dataPoints || []).filter(
    (p) => typeof p.reportsValue === 'number',
  );
  if (points.length > 0) return points;
  return (company.stats?.sparkline || [])
    .filter((n) => typeof n === 'number')
    .map((reportsValue) => ({ reportsValue }));
}

/** True when report volume meaningfully exceeds this service's own baseline. */
function isElevated(point: AllestoerungenDataPoint): boolean {
  const reports = point.reportsValue ?? 0;
  const baseline = point.baselineValue ?? 0;
  return (
    reports > baseline * config.statusAllestoerungenFactor &&
    reports >= config.statusAllestoerungenMinReports
  );
}

/**
 * Walk back from the newest reading through the current run of elevated ones to
 * find when this outage actually began — far more useful than "the first time we
 * happened to poll it".
 */
function outageStartedAt(points: AllestoerungenDataPoint[]): string | null {
  let started: string | null = null;
  for (let i = points.length - 1; i >= 0; i--) {
    if (!isElevated(points[i])) break;
    started = points[i].timestampUtc || started;
  }
  return started;
}

/** Map the site's traffic light onto a canonical Statuspage indicator. */
export function statusToIndicator(status: string | undefined, elevated: boolean): string {
  switch ((status || '').toLowerCase()) {
    case 'success':
      return 'none';
    case 'warning':
      return 'minor';
    case 'danger':
      return 'major';
    default:
      // Missing or unrecognised: fall back to what the chart says.
      return elevated ? 'minor' : 'unknown';
  }
}

/** Report volume for the current window, surfaced under `raw`. */
export interface AllestoerungenMetrics {
  /** Reports in the most recent 15-minute bucket. */
  reports: number;
  /** The service's own normal level for that bucket. */
  baseline: number;
  /** Highest reading in the ~24h window. */
  peak: number;
  /** Timestamp of the most recent bucket. */
  measured_at: string | null;
}

export function metricsOf(company: AllestoerungenCompany): AllestoerungenMetrics {
  const points = usablePoints(company);
  const latest = points[points.length - 1];
  return {
    reports: latest?.reportsValue ?? 0,
    baseline: latest?.baselineValue ?? 0,
    peak: points.reduce((max, p) => Math.max(max, p.reportsValue ?? 0), 0),
    measured_at: latest?.timestampUtc ?? null,
  };
}

/**
 * Convert a company object into a canonical {@link StatuspageSummary}.
 *
 * The incident name is constant for the life of an outage and `updated_at` is
 * left null, so consumers that diff incidents between polls see one incident
 * start and one end rather than a fresh "update" every 15 minutes.
 */
export function companyToSummary(
  company: AllestoerungenCompany,
  pageUrl: string,
): StatuspageSummary {
  const points = usablePoints(company);
  const latest = points[points.length - 1];
  const elevated = latest ? isElevated(latest) : false;
  const { reports } = metricsOf(company);

  let indicator = statusToIndicator(company.stats?.status, elevated);
  const flagged = indicator !== 'none' && indicator !== 'unknown';
  // Below the configured floor the signal is noise, not an outage.
  const suppressed = flagged && reports < config.statusAllestoerungenMinReports;
  if (suppressed) indicator = 'none';

  const incidents: NonNullable<StatuspageSummary['incidents']> = [];
  if (flagged && !suppressed) {
    incidents.push({
      name: 'User reports indicate problems',
      impact: indicator,
      status: 'identified',
      shortlink: pageUrl,
      started_at: outageStartedAt(points),
      updated_at: null,
    });
  }

  return {
    page: {
      name: company.name || company.slug || 'Unknown',
      url: pageUrl,
      updated_at: latest?.timestampUtc || null,
    },
    // A stable one-liner derived from severity alone: we always emit exactly one
    // incident, so the shared count-based escalation would call every outage
    // "Minor", and putting the live report count here would change the text on
    // every poll — which consumers read as a state change.
    status: {
      indicator,
      description: statusTextForIndicator(indicator as StatusIndicator),
    },
    incidents,
  };
}

/* -------------------------------------------------------------------------- */
/* Fetching                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Cloudflare fronts this site and answers bursts with `429 Cf-Mitigated:
 * challenge`, which a parallel provider fan-out would trigger instantly. So:
 * every request goes through one serialized queue with a minimum gap, results
 * are cached, and a page that can't be fetched falls back to the last good
 * reading rather than being reported as an outage.
 */
interface CacheEntry {
  at: number;
  company: AllestoerungenCompany;
}

const pageCache = new Map<string, CacheEntry>();
let snapshot: { at: number; companies: Map<string, AllestoerungenCompany> } | null = null;
let snapshotInFlight: Promise<Map<string, AllestoerungenCompany>> | null = null;
let chain: Promise<unknown> = Promise.resolve();
let lastRequestAt = 0;

export function clearAllestoerungenCache(): void {
  pageCache.clear();
  snapshot = null;
  snapshotInFlight = null;
  lastRequestAt = 0;
}

export function statusPageUrl(slug: string): string {
  const { statusAllestoerungenDomain: domain, statusAllestoerungenLocale: locale } = config;
  return `https://${domain}/${locale}/status/${slug}/`;
}

function homeUrl(): string {
  const { statusAllestoerungenDomain: domain, statusAllestoerungenLocale: locale } = config;
  return `https://${domain}/${locale}/`;
}

/** Queue `fn` behind any in-flight request, keeping a minimum gap between them. */
function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(async () => {
    const gap = config.statusAllestoerungenMinGapMs - (Date.now() - lastRequestAt);
    if (gap > 0) await new Promise((r) => setTimeout(r, gap));
    try {
      return await fn();
    } finally {
      lastRequestAt = Date.now();
    }
  });
  chain = run.catch(() => undefined);
  return run;
}

/** A page is only usable if it actually carries the embedded company data. */
function isUsable(html: string): boolean {
  return typeof html === 'string' && html.includes('CompanyType');
}

/**
 * Fetch a status page, escalating only as far as needed:
 *   1. plain HTTP with a browser UA — cheap, and enough most of the time;
 *   2. cloudscraper, then headless Chromium — for when Cloudflare challenges us.
 *
 * Step 2 is imported lazily so the puppeteer dependency never loads on the happy
 * path (or on deployments without Chromium installed).
 */
async function fetchPage(url: string): Promise<string> {
  let firstError: unknown;
  try {
    const resp = await statusGet<string>(url, {
      responseType: 'text',
      maxContentLength: PAGE_SIZE_LIMIT,
      headers: {
        'User-Agent': config.statusAllestoerungenUserAgent,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9,de;q=0.8',
      },
    });
    const html = typeof resp.data === 'string' ? resp.data : String(resp.data);
    if (isUsable(html)) return html;
    firstError = new Error('Response carried no status data (Cloudflare interstitial?)');
  } catch (error) {
    firstError = error;
  }

  if (!config.statusAllestoerungenUseBrowser) throw firstError;

  // Straight to Chromium: this host serves a Cloudflare *managed* challenge,
  // which cloudscraper cannot solve (it returns the "Just a moment..." 403), so
  // going through scrapeWithPuppeteer would only add a wasted round trip.
  const { scrapeWithBrowser } = await import('../../lib/puppeteer.js');
  const html = await scrapeWithBrowser(url);
  if (!isUsable(html)) {
    throw new Error(`Blocked by Cloudflare and no status data in fallback fetch (${String(firstError)})`);
  }
  return html;
}

/**
 * The site's "most reported problems" board, which embeds live stats for ~50
 * companies at once. One request covers most of what we ask about, which keeps
 * us far below the threshold where Cloudflare starts challenging.
 */
export async function getSnapshot(): Promise<Map<string, AllestoerungenCompany>> {
  if (snapshot && Date.now() - snapshot.at < config.statusAllestoerungenTtl * 1000) {
    return snapshot.companies;
  }
  // Collapse concurrent callers onto one request.
  if (snapshotInFlight) return snapshotInFlight;

  snapshotInFlight = serialize(() => fetchPage(homeUrl()).then(extractCompanies))
    .then((companies) => {
      snapshot = { at: Date.now(), companies };
      return companies;
    })
    .catch((error) => {
      // Serve the stale board rather than pretending nothing is wrong.
      if (snapshot) return snapshot.companies;
      throw error;
    })
    .finally(() => {
      snapshotInFlight = null;
    });

  return snapshotInFlight;
}

/** Fetch and cache a single service's own page (timestamped chart included). */
async function fetchOwnPage(slug: string): Promise<AllestoerungenCompany | null> {
  const company = await serialize(() => fetchPage(statusPageUrl(slug)).then(extractCompany));
  if (company) pageCache.set(slug, { at: Date.now(), company });
  return company;
}

interface LookupOptions {
  /**
   * Allow fetching the service's own page when the shared board can't answer.
   * Off for enrichment: a service missing from the board simply has no
   * crowd-reported problem, and paying a serialized request per service to
   * confirm that would cost tens of seconds per lookup.
   */
  allowFetch?: boolean;
  /**
   * Force the service's own page even if the board listed it, to recover the
   * timestamped series (and with it the true outage start) that the board's
   * bare sparkline lacks.
   */
  detailed?: boolean;
}

/**
 * Live stats for one slug, preferring the shared board. Falls back to a stale
 * entry on failure, because a Cloudflare challenge must never be mistaken for an
 * outage. Returns null when nothing is known and fetching isn't permitted.
 */
async function getCompany(
  slug: string,
  { allowFetch = true, detailed = false }: LookupOptions = {},
): Promise<AllestoerungenCompany | null> {
  const cached = pageCache.get(slug);
  const fresh = cached && Date.now() - cached.at < config.statusAllestoerungenTtl * 1000;
  if (fresh && cached && (!detailed || cached.company.stats?.chartData)) return cached.company;

  try {
    const board = await getSnapshot().catch(() => null);
    const listed = board?.get(slug);
    if (listed && !detailed) {
      pageCache.set(slug, { at: Date.now(), company: listed });
      return listed;
    }
    if (!allowFetch && !detailed) return listed ?? cached?.company ?? null;

    const company = await fetchOwnPage(slug);
    // The board's coarser reading still beats nothing.
    return company ?? listed ?? cached?.company ?? null;
  } catch {
    return cached?.company ?? null;
  }
}

/* -------------------------------------------------------------------------- */
/* Provider                                                                   */
/* -------------------------------------------------------------------------- */

export interface AllestoerungenProviderOptions {
  /** Service id used in the unified response, e.g. "call-of-duty". */
  service: string;
  /** allestörungen slug, e.g. "call-of-duty". */
  slug: string;
  /** Display name; defaults to the name the page reports. */
  label?: string;
  category?: string;
  brandColor?: string;
  icon?: string;
}

/** "call-of-duty" -> "Call Of Duty", used only if the page gives us no name. */
function labelFromSlug(slug: string): string {
  return slug
    .split('-')
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(' ');
}

/** Canonical category slug -> the display name we group under. */
export const CATEGORY_NAMES: Record<string, string> = {
  isp: 'Internet',
  games: 'Games',
};

/**
 * Upstream category slug -> our canonical slug.
 *
 * The site splits connectivity providers across several categories — Telekom,
 * o2 and 1&1 are "converged-communications", Vodafone "business-communications",
 * Deutsche Glasfaser and PYUR "isp" — which would scatter them across four
 * groups in our output. They're all `isp`.
 */
export const CATEGORY_SLUGS: Record<string, string> = {
  isp: 'isp',
  internet: 'isp',
  'converged-communications': 'isp',
  'business-communications': 'isp',
  'foundational-internet': 'isp',
  games: 'games',
  'gaming-platforms': 'games',
  'game-publishers': 'games',
};

/**
 * The company's own logo, used when we have no better icon.
 *
 * Most of these services aren't in Simple Icons (regional ISPs, banks), so the
 * site's own artwork is the only thing that covers all of them — and unlike the
 * monochrome brand marks used elsewhere, these are full colour, which suits API
 * consumers that render them as entity pictures.
 */
export function logoUrl(company: AllestoerungenCompany): string | undefined {
  const logo = company.logo?.trim();
  if (!logo) return undefined;
  if (logo.startsWith('http')) return logo;
  return LOGO_BASE + logo.replace(/^\/+/, '');
}

/** Our canonical category slug for a company, e.g. "isp". */
export function categorySlugOf(company: AllestoerungenCompany): string | undefined {
  const { name, slug } = company.category ?? {};
  const key = (slug || name || '').toLowerCase().replace(/\s+/g, '-');
  return CATEGORY_SLUGS[key];
}

/**
 * The company's category as displayed. Status pages carry a display name, the
 * shared board only a slug ("gaming-platforms"); either is normalized to a
 * canonical slug first, falling back to prettifying whatever we were given.
 */
export function categoryOf(company: AllestoerungenCompany): string | undefined {
  const canonical = categorySlugOf(company);
  if (canonical) return CATEGORY_NAMES[canonical];
  const { name, slug } = company.category ?? {};
  return name || (slug ? labelFromSlug(slug) : undefined);
}

/** Build a status Provider backed by an allestörungen status page. */
export function makeAllestoerungenProvider(opts: AllestoerungenProviderOptions): Provider {
  return {
    name: opts.service,

    isAvailable() {
      return true;
    },

    async lookup(_query: string, _type?: LookupType): Promise<ProviderResult<StatusData>> {
      const start = Date.now();
      try {
        const company = await getCompany(opts.slug);
        if (!company) {
          throw new Error(
            `No data for "${opts.slug}" (unknown slug, blocked, or the page layout changed)`,
          );
        }
        const summary = companyToSummary(company, statusPageUrl(opts.slug));
        return {
          provider: opts.service,
          success: true,
          data: summaryToStatusData(
            summary,
            opts.service,
            opts.label || company.name || labelFromSlug(opts.slug),
            undefined,
            // We supply our own stable one-liner; see describeIndicator.
            true,
            undefined,
            opts.category || categoryOf(company),
            opts.brandColor,
            // An explicit icon wins; otherwise fall back to the site's own logo
            // so every service gets one without hand-curating a list.
            opts.icon || logoUrl(company),
          ),
          // Report volume is the whole point of this source, so expose it.
          raw: { ...summary, metrics: metricsOf(company) },
          duration: Date.now() - start,
        };
      } catch (error) {
        return {
          provider: opts.service,
          success: false,
          data: {},
          error: error instanceof Error ? error.message : String(error),
          duration: Date.now() - start,
        };
      }
    },
  };
}

/**
 * Parse the configured service list.
 *
 * Entries are `slug[=Label[=icon[=Category]]]`, e.g.
 * `call-of-duty=Call of Duty=activision=Games`. Trailing fields can be left
 * empty (`congstar=congstar==Internet`) to set only the ones you care about;
 * an omitted category is derived from the site's own via {@link CATEGORY_MAP}.
 *
 * The service id is the slug, so prefer slugs that don't collide with a built-in
 * provider — the unified response would otherwise carry two entries for it.
 */
export function parseServiceSpecs(raw: string): AllestoerungenProviderOptions[] {
  const out: AllestoerungenProviderOptions[] = [];
  const seen = new Set<string>();
  for (const entry of (raw || '').split(',')) {
    const [slugPart, labelPart, iconPart, categoryPart] = entry.split('=').map((s) => s.trim());
    const slug = (slugPart || '').toLowerCase();
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    out.push({
      service: slug,
      slug,
      label: labelPart || undefined,
      icon: iconPart || undefined,
      category: categoryPart || undefined,
    });
  }
  return out;
}

/**
 * Standalone services — ones allestörungen covers that no other provider does
 * (German ISPs, banks, individual games). Configured via
 * STATUS_ALLESTOERUNGEN_SERVICES; these become providers in their own right.
 */
export const ALLESTOERUNGEN_SERVICES: AllestoerungenProviderOptions[] = parseServiceSpecs(
  config.statusAllestoerungenServices,
);

/* -------------------------------------------------------------------------- */
/* Enricher                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Built-in provider id -> allestörungen slug.
 *
 * These services already have an authoritative provider, so the crowd signal is
 * injected into that provider's result instead of competing with it.
 */
export const CROWD_SLUGS: Record<string, string> = {
  discord: 'discord',
  steam: 'steam',
  cs2: 'counter-strike',
  playstation: 'playstation-network',
  xbox: 'xbox-live',
  epic: 'epic-games-store',
  twitch: 'twitch',
  reddit: 'reddit',
  github: 'github',
  cloudflare: 'cloudflare',
  vrchat: 'vrchat',
  battlenet: 'battle-net',
  nintendo: 'nintendo-switch-online',
  activision: 'call-of-duty',
  ea: 'ea',
  aws: 'aws-amazon-web-services',
  azure: 'windows-azure',
  gcp: 'google-cloud',
  openai: 'openai',
  claude: 'claude-ai',
  netlify: 'netlify',
  digitalocean: 'digitalocean',
  bluesky: 'bluesky',
};

/** Parse STATUS_ALLESTOERUNGEN_MAP ("service=slug,…") into overrides. */
export function parseCrowdMap(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of (raw || '').split(',')) {
    const [service, slug] = entry.split('=').map((s) => s.trim().toLowerCase());
    // `service=` with an empty slug disables the built-in mapping.
    if (service) out[service] = slug || '';
  }
  return out;
}

function crowdSlugFor(service: string): string | undefined {
  const overrides = parseCrowdMap(config.statusAllestoerungenMap);
  const slug = service in overrides ? overrides[service] : CROWD_SLUGS[service];
  return slug || undefined;
}

/** Severity the site's traffic light has to reach before we escalate a service. */
function escalationAllowed(indicator: string): boolean {
  if (indicator === 'major' || indicator === 'critical') return true;
  return indicator === 'minor' && config.statusAllestoerungenEscalateOnWarning;
}

/**
 * When we first saw each service's current outage.
 *
 * The shared board reports report *counts* with no timestamps, and fetching each
 * troubled service's own page to recover the real start costs a serialized
 * request apiece. So we date an outage from the first poll that saw it — the
 * same approach the other stateless feeds (Steam, Blizzard) take — and clear it
 * once the service recovers so the next outage starts a fresh clock.
 */
const outageFirstSeen = new Map<string, string>();

export function clearOutageHistory(): void {
  outageFirstSeen.clear();
}

function firstSeenAt(service: string, ongoing: boolean): string | null {
  if (!ongoing) {
    outageFirstSeen.delete(service);
    return null;
  }
  const existing = outageFirstSeen.get(service);
  if (existing) return existing;
  const now = new Date().toISOString();
  outageFirstSeen.set(service, now);
  return now;
}

/**
 * Crowd-sourced reports as an enricher.
 *
 * Because it only ever escalates, a spike in user reports can flag a service as
 * degraded before the vendor's own page admits it — the whole point of this
 * source — while a vendor-declared outage always outranks it.
 */
export const crowdEnricher: StatusEnricher = {
  name: 'allestoerungen',

  async prepare(): Promise<void> {
    if (Object.keys(CROWD_SLUGS).length === 0) return;
    // Warm the shared board once so per-service lookups cost nothing.
    await getSnapshot().catch(() => undefined);
  },

  async enrich(service: string): Promise<StatusEnrichment | null> {
    const slug = crowdSlugFor(service);
    if (!slug) return null;

    // Board-only: a service the board doesn't list has no crowd-reported
    // problem, and confirming that per service would cost a serialized request
    // each — which measured at 19s per lookup versus 4s for the board alone.
    const company = await getCompany(slug, { allowFetch: false });
    if (!company) return null;

    const summary = companyToSummary(company, statusPageUrl(slug));
    const indicator = summary.status?.indicator || 'unknown';
    const metrics = metricsOf(company);
    const raw = { slug, status: company.stats?.status ?? null, ...metrics };

    const escalating = escalationAllowed(indicator) && (summary.incidents || []).length > 0;
    // Track (and reset) the outage clock on every poll, not just escalating ones,
    // so recovery clears it.
    const startedAt = firstSeenAt(service, escalating);

    if (!escalating) {
      // Still worth reporting the numbers even when we don't act on them.
      return { raw };
    }

    return {
      indicator: indicator as StatusEnrichment['indicator'],
      incidents: (summary.incidents || []).map((i) => ({
        service,
        name: i.name || 'User reports indicate problems',
        impact: i.impact ?? null,
        status: i.status ?? null,
        url: i.shortlink ?? null,
        // The site's own timeline when we have it, else when we first saw it.
        started_at: i.started_at ?? startedAt,
        updated_at: null,
      })),
      raw,
    };
  },
};
