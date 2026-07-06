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
 * The endpoint is app 730 (CS2), so it only carries Steam-wide services (login,
 * community) plus CS2-specific ones (economy, leaderboards) — Valve doesn't
 * expose this for other games. We split it into two independent services:
 * "Steam" (the platform) and "Counter-Strike 2" (its economy/leaderboards), so
 * each reads consistently instead of hiding CS2 issues under Steam.
 */
const STEAM_STATUS_URL = 'https://api.steampowered.com/ICSGOServers_730/GetGameServersStatus/v1/';

/** Which raw services belong to which reported service, and their display labels. */
const GROUPS: Array<{
  service: string;
  label: string;
  members: Record<string, string>;
}> = [
  {
    service: 'steam',
    label: 'Steam',
    members: { SessionsLogon: 'Sessions & Login', SteamCommunity: 'Community' },
  },
  {
    service: 'cs2',
    label: 'Counter-Strike 2',
    members: { IEconItems: 'Economy / Inventories', Leaderboards: 'Leaderboards' },
  },
];

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

/** Build a canonical summary for one group of Steam services. */
export function steamGroupSummary(
  services: Record<string, string>,
  members: Record<string, string>,
  label: string,
): StatuspageSummary {
  const entries = Object.entries(members)
    .filter(([key]) => key in services)
    .map(([key, memberLabel]) => ({
      label: memberLabel,
      state: services[key],
      indicator: stateToIndicator(services[key]),
    }));

  const worst = entries.reduce(
    (acc, e) => ((SEVERITY_RANK[e.indicator] ?? 1) > (SEVERITY_RANK[acc] ?? 1) ? e.indicator : acc),
    'none',
  );
  const issues = entries.filter((e) => e.indicator !== 'none');

  return {
    page: { name: label, url: PAGE_URL, updated_at: null },
    status: {
      indicator: worst,
      description:
        worst === 'none'
          ? 'All Systems Operational'
          : `Issues affecting: ${issues.map((e) => e.label).join(', ')}`,
    },
    incidents: issues.map((e) => ({
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
      const services = resp.data?.result?.services || {};

      // Emit one service entry per group (Steam + Counter-Strike 2), merged.
      const mergedServices: NonNullable<StatusData['services']> = [];
      const mergedIncidents: NonNullable<StatusData['incidents']> = [];
      const raw: Record<string, unknown> = {};
      for (const g of GROUPS) {
        const summary = steamGroupSummary(services, g.members, g.label);
        // Both "steam" and "cs2" derive from the same Steam Web API feed, so
        // tag their shared origin via `source`.
        const data = summaryToStatusData(summary, g.service, g.label, undefined, false, PROVIDER_NAME);
        mergedServices.push(...(data.services || []));
        mergedIncidents.push(...(data.incidents || []));
        raw[g.service] = summary;
      }

      return {
        provider: PROVIDER_NAME,
        success: true,
        data: { services: mergedServices, incidents: mergedIncidents },
        raw,
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
