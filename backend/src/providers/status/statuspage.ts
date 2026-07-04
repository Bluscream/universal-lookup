import type {
  LookupType,
  Provider,
  ProviderResult,
  StatusData,
  StatusIndicator,
} from '../../types/common.js';
import { statusGet } from './http.js';

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
 * Convert a canonical {@link StatuspageSummary} into our unified {@link StatusData}
 * (a single-element `services` array plus active `incidents`). Shared by every
 * provider so proprietary formats come out identical to native Statuspage ones.
 */
export function summaryToStatusData(
  summary: StatuspageSummary,
  service: string,
  label: string,
): StatusData {
  const indicator = normalizeIndicator(summary.status?.indicator);

  // Only surface incidents that are not yet resolved.
  const activeIncidents = (summary.incidents || []).filter(
    (i) => (i.status || '').toLowerCase() !== 'resolved',
  );

  return {
    services: [
      {
        service,
        name: label,
        indicator,
        status: summary.status?.description || 'Unknown',
        operational: indicator === 'none',
        updated_at: summary.page?.updated_at || null,
        page_url: summary.page?.url || null,
        active_incidents: activeIncidents.length,
        source: service,
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
          data: summaryToStatusData(summary, opts.service, opts.label),
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
];
