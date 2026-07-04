import { config } from '../../config.js';
import type { LookupType, Provider, ProviderResult, StatusData } from '../../types/common.js';
import { statusGet } from './http.js';
import { type StatuspageSummary, summaryToStatusData } from './statuspage.js';

const PROVIDER_NAME = 'ubisoft';
const PAGE_URL = 'https://www.ubisoft.com/en-us/help/gameStatus';

/**
 * Ubisoft has no Statuspage; its per-game status pages call a public endpoint:
 *   GET https://public-ubiservices.ubi.com/v1/applications/gameStatuses?applicationIds=<guid,guid,...>
 *   header: Ubi-AppId: <public web app id>   (401 without it; no user auth needed)
 *
 * The endpoint is generic — it returns the status of ANY Ubisoft app/game (and
 * the Ubisoft Connect launcher) given its applicationId. There is no "list all"
 * call, so we query a configurable set of app IDs (STATUS_UBISOFT_APP_IDS).
 *
 *   { gameStatuses: [ { applicationId, name, platformType, status: "online"|…,
 *                       isMaintenance, impactedFeatures: [] } ] }
 */
const UBISOFT_STATUS_URL = 'https://public-ubiservices.ubi.com/v1/applications/gameStatuses';

interface UbisoftGameStatus {
  applicationId?: string;
  name?: string;
  platformType?: string;
  status?: string;
  isMaintenance?: boolean;
  impactedFeatures?: unknown[];
}
interface UbisoftResponse {
  lastModifiedAt?: string;
  gameStatuses?: UbisoftGameStatus[];
}

/** Map a single Ubisoft app entry onto a canonical indicator. */
function entryIndicator(g: UbisoftGameStatus): string {
  if (g.isMaintenance) return 'maintenance';
  const s = (g.status || '').toLowerCase();
  if (s === 'online') {
    return Array.isArray(g.impactedFeatures) && g.impactedFeatures.length > 0 ? 'minor' : 'none';
  }
  if (s === 'degraded' || s === 'limited') return 'minor';
  // "interrupted", "offline", unknown non-online states
  return s === '' ? 'unknown' : 'major';
}

const SEVERITY_RANK: Record<string, number> = {
  none: 0,
  maintenance: 1,
  minor: 2,
  major: 3,
  critical: 4,
  unknown: 1,
};

/** Convert the Ubisoft gameStatuses payload into a canonical StatuspageSummary. */
export function ubisoftToSummary(body: UbisoftResponse): StatuspageSummary {
  const games = body.gameStatuses || [];
  const entries = games.map((g) => ({ game: g, indicator: entryIndicator(g) }));

  const worst = entries.reduce(
    (acc, e) => ((SEVERITY_RANK[e.indicator] ?? 1) > (SEVERITY_RANK[acc] ?? 1) ? e.indicator : acc),
    'none',
  );
  const affected = entries.filter((e) => e.indicator !== 'none');

  return {
    page: { name: 'Ubisoft', url: PAGE_URL, updated_at: body.lastModifiedAt || null },
    status: {
      indicator: worst,
      description:
        worst === 'none'
          ? 'All Services Are Up and Running'
          : `Issues affecting: ${affected.map((e) => e.game.name).filter(Boolean).join(', ')}`,
    },
    incidents: affected.map((e) => {
      const features = Array.isArray(e.game.impactedFeatures)
        ? (e.game.impactedFeatures as string[]).filter((f) => typeof f === 'string')
        : [];
      const detail = e.game.isMaintenance
        ? 'maintenance'
        : e.game.status || (features.length ? features.join(', ') : 'issue');
      return {
        name: `${e.game.name || e.game.applicationId}: ${detail}`,
        impact: e.game.isMaintenance ? 'maintenance' : e.game.status || 'issue',
        status: 'identified',
        shortlink: PAGE_URL,
        updated_at: body.lastModifiedAt || null,
      };
    }),
  };
}

export const ubisoftProvider: Provider = {
  name: PROVIDER_NAME,

  isAvailable() {
    return !!config.statusUbisoftAppIds && !!config.statusUbisoftAppId;
  },

  async lookup(_query: string, _type?: LookupType): Promise<ProviderResult<StatusData>> {
    const start = Date.now();
    try {
      const resp = await statusGet<UbisoftResponse>(UBISOFT_STATUS_URL, {
        params: { applicationIds: config.statusUbisoftAppIds },
        headers: { 'Ubi-AppId': config.statusUbisoftAppId, Accept: 'application/json' },
      });
      const summary = ubisoftToSummary(resp.data || {});
      return {
        provider: PROVIDER_NAME,
        success: true,
        data: summaryToStatusData(summary, PROVIDER_NAME, 'Ubisoft'),
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
