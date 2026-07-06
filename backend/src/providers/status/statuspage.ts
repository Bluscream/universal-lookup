import { config } from '../../config.js';
import type {
  LookupType,
  Provider,
  ProviderResult,
  StatusData,
  StatusIndicator,
} from '../../types/common.js';
import { statusGet } from './http.js';
import { serviceCategory, serviceIconUrl } from './icons.js';

let _ignoredCache: { raw: string; set: Set<string> } | null = null;

/** Parsed STATUS_IGNORED list (lower-cased), memoized on the raw config string. */
function ignoredIssues(): Set<string> {
  const raw = config.statusIgnored;
  if (!_ignoredCache || _ignoredCache.raw !== raw) {
    _ignoredCache = {
      raw,
      set: new Set(
        raw
          .split(';')
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean),
      ),
    };
  }
  return _ignoredCache.set;
}

/** True if an incident name matches any ignored entry (case-insensitive substring). */
function isIgnored(name: string, ignored: Set<string>): boolean {
  if (ignored.size === 0) return false;
  const n = (name || '').trim().toLowerCase();
  if (ignored.has(n)) return true;
  for (const ig of ignored) {
    if (n.includes(ig)) return true;
  }
  return false;
}

/**
 * Atlassian Statuspage v2 `summary.json` shape — the de-facto standard used by
 * Discord, Cloudflare, GitHub, Reddit, Twitch, VRChat, Epic Games, and many more.
 *
 * This is also our **canonical intermediate format**: every provider (including
 * the proprietary Xbox / PlayStation / Activision feeds) converts its response
 * into a `StatuspageSummary` and then runs it through {@link summaryToStatusData},
 * so all providers emit an identical unified shape (and identical `raw`).
 */
export interface StatuspageSummary {
  page?: { name?: string; url?: string; updated_at?: string | null };
  status?: { indicator?: string; description?: string };
  components?: unknown[];
  incidents?: Array<{
    name?: string;
    status?: string | null;
    impact?: string | null;
    shortlink?: string | null;
    created_at?: string | null;
    started_at?: string | null;
    updated_at?: string | null;
  }>;
  scheduled_maintenances?: unknown[];
}

/** Statuspage indicators map 1:1 to our canonical indicators. */
export function normalizeIndicator(indicator?: string): StatusIndicator {
  switch ((indicator || '').toLowerCase()) {
    case 'none':
      return 'none';
    case 'minor':
      return 'minor';
    case 'major':
      return 'major';
    case 'critical':
      return 'critical';
    case 'maintenance':
      return 'maintenance';
    default:
      return 'unknown';
  }
}

/**
 * Produce the concise one-line status label shown in the UI.
 *
 * Operational is always "All Systems Operational". For `verbatim` feeds (native
 * Statuspage / Instatus) the upstream one-liner is kept as-is. Otherwise the
 * label is normalized: maintenance -> "Under Maintenance", a single active
 * incident -> "Minor Service Outage", more than one -> "Major Service Outage".
 */
export function normalizeStatusText(
  indicator: StatusIndicator,
  activeIncidents: number,
  description: string | undefined,
  verbatim: boolean,
): string {
  if (indicator === 'none') return 'All Systems Operational';
  if (verbatim && description) return description;
  if (indicator === 'maintenance') return 'Under Maintenance';
  return activeIncidents > 1 ? 'Major Service Outage' : 'Minor Service Outage';
}

/**
 * Convert a canonical {@link StatuspageSummary} into our unified {@link StatusData}
 * (a single-element `services` array plus active `incidents`). Shared by every
 * provider so proprietary formats come out identical to native Statuspage ones.
 */
export function summaryToStatusData(
  summary: StatuspageSummary,
  service: string,
  label: string,
  ignored: Set<string> = ignoredIssues(),
  /**
   * When true, keep the upstream `summary.status.description` verbatim (for
   * feeds that already return a short, concise one-line status — native
   * Atlassian Statuspage and Instatus). When false (default, for our
   * hand-rolled providers) the status text is normalized to a consistent
   * "All Systems Operational / Minor Service Outage / Major Service Outage /
   * Under Maintenance" set so the UI reads uniformly.
   */
  verbatim: boolean = false,
): StatusData {
  let indicator = normalizeIndicator(summary.status?.indicator);

  // Only surface incidents that are not yet resolved.
  const unresolved = (summary.incidents || []).filter(
    (i) => (i.status || '').toLowerCase() !== 'resolved',
  );
  // Drop ignored incidents (STATUS_IGNORED).
  const activeIncidents = unresolved.filter((i) => !isIgnored(i.name || '', ignored));

  // If a service's only incidents were all ignored, treat it as operational.
  const allIgnored = unresolved.length > 0 && activeIncidents.length === 0;
  if (indicator !== 'none' && allIgnored) indicator = 'none';

  const operational = indicator === 'none';
  const status = normalizeStatusText(indicator, activeIncidents.length, summary.status?.description, verbatim);

  return {
    services: [
      {
        service,
        name: label,
        indicator,
        status,
        operational,
        updated_at: summary.page?.updated_at || null,
        page_url: summary.page?.url || null,
        icon: serviceIconUrl(service),
        category: serviceCategory(service),
        active_incidents: activeIncidents.length,
      },
    ],
    incidents: activeIncidents.map((i) => ({
      service,
      name: i.name || 'Incident',
      impact: i.impact || null,
      status: i.status || null,
      url: i.shortlink || null,
      started_at: i.started_at || i.created_at || null,
      updated_at: i.updated_at || null,
    })),
  };
}

export interface StatuspageProviderOptions {
  /** Provider/service id, e.g. "discord". */
  service: string;
  /** Human-friendly service name, e.g. "Discord". */
  label: string;
  /** The `summary.json` endpoint. */
  url: string;
}

/**
 * Build a status Provider backed by a native Atlassian Statuspage `summary.json`
 * endpoint. The body is already in canonical form, so it goes straight through
 * {@link summaryToStatusData}.
 */
export function makeStatuspageProvider(opts: StatuspageProviderOptions): Provider {
  return {
    name: opts.service,

    isAvailable() {
      return true;
    },

    async lookup(_query: string, _type?: LookupType): Promise<ProviderResult<StatusData>> {
      const start = Date.now();
      try {
        const resp = await statusGet<StatuspageSummary>(opts.url);
        const summary = resp.data || {};
        return {
          provider: opts.service,
          success: true,
          data: summaryToStatusData(summary, opts.service, opts.label, undefined, true),
          raw: summary,
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

/** Registry of services that expose a standard Statuspage `summary.json`. */
export const STATUSPAGE_SERVICES: StatuspageProviderOptions[] = [
  { service: 'discord', label: 'Discord', url: 'https://discordstatus.com/api/v2/summary.json' },
  { service: 'vrchat', label: 'VRChat', url: 'https://status.vrchat.com/api/v2/summary.json' },
  {
    service: 'cloudflare',
    label: 'Cloudflare',
    url: 'https://www.cloudflarestatus.com/api/v2/summary.json',
  },
  { service: 'github', label: 'GitHub', url: 'https://www.githubstatus.com/api/v2/summary.json' },
  { service: 'epic', label: 'Epic Games', url: 'https://status.epicgames.com/api/v2/summary.json' },
  { service: 'reddit', label: 'Reddit', url: 'https://www.redditstatus.com/api/v2/summary.json' },
  { service: 'twitch', label: 'Twitch', url: 'https://status.twitch.com/api/v2/summary.json' },
  // Cloud / hosting providers (Atlassian Statuspage)
  { service: 'vercel', label: 'Vercel', url: 'https://www.vercel-status.com/api/v2/summary.json' },
  {
    service: 'digitalocean',
    label: 'DigitalOcean',
    url: 'https://status.digitalocean.com/api/v2/summary.json',
  },
  { service: 'netlify', label: 'Netlify', url: 'https://www.netlifystatus.com/api/v2/summary.json' },
  { service: 'mongodb', label: 'MongoDB', url: 'https://status.mongodb.com/api/v2/summary.json' },
  // Dev tools / web / social (Atlassian Statuspage)
  { service: 'sentry', label: 'Sentry', url: 'https://status.sentry.io/api/v2/summary.json' },
  // Bluesky's custom status domain doesn't serve the API; use its Statuspage id.
  { service: 'bluesky', label: 'Bluesky', url: 'https://zp3d53cvflx3.statuspage.io/api/v2/summary.json' },
  // AI providers (Atlassian Statuspage)
  { service: 'openai', label: 'OpenAI', url: 'https://status.openai.com/api/v2/summary.json' },
  { service: 'claude', label: 'Claude', url: 'https://status.claude.com/api/v2/summary.json' },
  { service: 'windsurf', label: 'Windsurf', url: 'https://status.windsurf.com/api/v2/summary.json' },
  { service: 'devin', label: 'Devin', url: 'https://www.devinstatus.com/api/v2/summary.json' },
];
