import type { LookupType, Provider, ProviderResult, StatusData } from '../../types/common.js';
import { statusGet } from './http.js';
import { type StatuspageSummary, summaryToStatusData } from './statuspage.js';

const PROVIDER_NAME = 'activision';
const PAGE_URL = 'https://support.activision.com/onlineservices';

/**
 * Activision Online Services status — the same public endpoint the "codstatus"
 * Discord cog and the Warzone Helper's WarzoneStatusParser consume. Entries in
 * `serverStatuses` represent an active issue (empty array = all operational).
 *
 *   { "updatedTime": …, "serverStatuses": [ { "gameTitle", "platform", "status",
 *     "eventId", "alertId" } ], "recentlyResolved": [ … ] }
 *
 * Converted into a canonical StatuspageSummary for the shared mapper.
 */
const ACTIVISION_STATUS_URL =
  'https://prod-psapi.infra-ext.activision.com/open/api/apexrest/oshp/landingpage';

interface ActivisionEntry {
  gameTitle?: string;
  platform?: string;
  status?: string | null;
}
interface ActivisionLanding {
  updatedTime?: string | number;
  serverStatuses?: ActivisionEntry[];
}

/** Best-effort conversion of Activision's updatedTime into an ISO string. */
function toIso(t?: string | number): string | null {
  if (t === undefined || t === null || t === '') return null;
  const n = typeof t === 'number' ? t : Number(t);
  if (!Number.isNaN(n)) {
    // Heuristic: seconds vs milliseconds.
    const ms = n < 1e12 ? n * 1000 : n;
    const d = new Date(ms);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  const parsed = new Date(t);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/** Convert the Activision landing feed into a canonical StatuspageSummary. */
export function activisionToSummary(body: ActivisionLanding): StatuspageSummary {
  const updatedAt = toIso(body.updatedTime);
  const issues = (body.serverStatuses || []).filter(
    (e) => (e.gameTitle || '').length > 0 || (e.platform || '').length > 0,
  );
  const hasIssues = issues.length > 0;

  return {
    page: { name: 'Activision Online Services', url: PAGE_URL, updated_at: updatedAt },
    status: {
      indicator: hasIssues ? 'major' : 'none',
      description: hasIssues
        ? `${issues.length} active issue${issues.length === 1 ? '' : 's'}`
        : 'All Systems Operational',
    },
    incidents: issues.map((e) => {
      const title = [e.gameTitle, e.platform].filter(Boolean).join(' — ') || 'Service issue';
      return {
        name: e.status ? `${title}: ${e.status}` : title,
        impact: e.status || 'issue',
        status: 'identified',
        shortlink: PAGE_URL,
        updated_at: updatedAt,
      };
    }),
  };
}

export const activisionProvider: Provider = {
  name: PROVIDER_NAME,

  isAvailable() {
    return true;
  },

  async lookup(_query: string, _type?: LookupType): Promise<ProviderResult<StatusData>> {
    const start = Date.now();
    try {
      const resp = await statusGet<ActivisionLanding>(ACTIVISION_STATUS_URL, {
        headers: { Accept: 'application/json' },
      });
      const body: ActivisionLanding =
        typeof resp.data === 'string' ? JSON.parse(resp.data) : resp.data;
      const summary = activisionToSummary(body);
      return {
        provider: PROVIDER_NAME,
        success: true,
        data: summaryToStatusData(summary, PROVIDER_NAME, 'Activision'),
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
