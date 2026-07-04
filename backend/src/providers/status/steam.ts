import { config } from '../../config.js';
import type { LookupType, Provider, ProviderResult, StatusData } from '../../types/common.js';
import { statusGet } from './http.js';
import { type StatuspageSummary, summaryToStatusData } from './statuspage.js';

const PROVIDER_NAME = 'steam';
const PAGE_URL = 'https://steamstat.us/';

/**
 * Steam has no official status page. steamstat.us derives its data from the
 * official Steam Web API `ICSGOServers_730/GetGameServersStatus` endpoint (its
 * README explicitly asks third parties NOT to scrape steamstat.us itself), so we
 * query that official API directly with the configured Steam Web API key.
 *
 *   result.services = { SessionsLogon, SteamCommunity, IEconItems, Leaderboards }
 *   values: "normal" | "idle" | "delayed" | "surge" | "offline" | "critical"
 *
 * Overall health is driven by the core Steam services (login + community); the
 * CS2-specific econ/leaderboard services are surfaced as incidents only.
 */
const STEAM_STATUS_URL = 'https://api.steampowered.com/ICSGOServers_730/GetGameServersStatus/v1/';

/** Core services that represent "is Steam itself up". */
const CORE_SERVICES = new Set(['SessionsLogon', 'SteamCommunity']);

const SERVICE_LABELS: Record<string, string> = {
  SessionsLogon: 'Steam Sessions & Login',
  SteamCommunity: 'Steam Community',
  IEconItems: 'Steam Economy / Inventories',
  Leaderboards: 'Steam Leaderboards',
};

interface SteamStatusResponse {
  result?: { services?: Record<string, string> };
}

/** Map a Steam service state onto a canonical Statuspage indicator. */
function stateToIndicator(state: string): string {
  switch ((state || '').toLowerCase()) {
    case 'normal':
    case 'idle': // idle = no current activity, not an outage
      return 'none';
    case 'delayed':
    case 'surge':
      return 'minor';
    case 'offline':
      return 'major';
    case 'critical':
      return 'critical';
    default:
      return 'unknown';
  }
}

const SEVERITY_RANK: Record<string, number> = {
  none: 0,
  maintenance: 1,
  minor: 2,
  major: 3,
  critical: 4,
  unknown: 1,
};

/** Convert the Steam GetGameServersStatus payload into a canonical StatuspageSummary. */
export function steamToSummary(body: SteamStatusResponse): StatuspageSummary {
  const services = body.result?.services || {};
  const entries = Object.entries(services).map(([key, state]) => ({
    key,
    label: SERVICE_LABELS[key] || key,
    state,
    indicator: stateToIndicator(state),
    core: CORE_SERVICES.has(key),
  }));

  // Overall severity is driven by the core services only.
  const coreEntries = entries.filter((e) => e.core);
  const worst = coreEntries.reduce(
    (acc, e) => ((SEVERITY_RANK[e.indicator] ?? 1) > (SEVERITY_RANK[acc] ?? 1) ? e.indicator : acc),
    'none',
  );
  const coreIssues = coreEntries.filter((e) => e.indicator !== 'none');

  // Any non-normal service (core or CS-specific) becomes an incident.
  const incidents = entries.filter((e) => e.indicator !== 'none');

  return {
    page: { name: 'Steam', url: PAGE_URL, updated_at: null },
    status: {
      indicator: worst,
      description:
        worst === 'none'
          ? 'Steam is operational'
          : `Issues affecting: ${coreIssues.map((e) => e.label).join(', ')}`,
    },
    incidents: incidents.map((e) => ({
      name: `${e.label}: ${e.state}`,
      impact: e.state,
      status: 'identified',
      shortlink: PAGE_URL,
    })),
  };
}

export const steamProvider: Provider = {
  name: PROVIDER_NAME,

  isAvailable() {
    return !!config.steamApiKey;
  },

  async lookup(_query: string, _type?: LookupType): Promise<ProviderResult<StatusData>> {
    const start = Date.now();
    try {
      const resp = await statusGet<SteamStatusResponse>(STEAM_STATUS_URL, {
        params: { key: config.steamApiKey },
      });
      const summary = steamToSummary(resp.data || {});
      return {
        provider: PROVIDER_NAME,
        success: true,
        data: summaryToStatusData(summary, PROVIDER_NAME, 'Steam'),
        raw: summary,
        duration: Date.now() - start,
      };
    } catch (error) {
      return {
        provider: PROVIDER_NAME,
        success: false,
        data: {},
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - start,
      };
    }
  },
};
