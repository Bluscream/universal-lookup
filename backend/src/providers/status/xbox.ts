import type { LookupType, Provider, ProviderResult, StatusData } from '../../types/common.js';
import { statusGet } from './http.js';
import { type StatuspageSummary, summaryToStatusData } from './statuspage.js';

const PROVIDER_NAME = 'xbox';
const PAGE_URL = 'https://support.xbox.com/xbox-live-status';

/**
 * Xbox Live has no Statuspage endpoint; the official support site is driven by an
 * undocumented feed at xnotify.xboxlive.com that content-negotiates to JSON:
 *
 *   { "Status": { "Overall": { "State": "None", "LastUpdated": "…" } },
 *     "CoreServices": [ { "Name": "Account & profile", "Status": { "Name": "None" } } ] }
 *
 * A `State`/`Status.Name` of "None" means no known issues. We convert this into a
 * canonical StatuspageSummary so the shared mapper produces the unified shape.
 */
const XBOX_STATUS_URL = 'https://xnotify.xboxlive.com/servicestatusv6/US/en-US';

interface XboxCategory {
  Name?: string;
  Status?: { Name?: string };
}
interface XboxServiceStatus {
  Status?: { Overall?: { State?: string; LastUpdated?: string } };
  CoreServices?: XboxCategory[];
}

/** Map an Xbox state string onto a canonical Statuspage indicator. */
function indicatorFromState(state: string): string {
  const s = (state || '').toLowerCase();
  if (s === 'none') return 'none';
  if (s === 'limited' || s === 'warning') return 'minor';
  if (s === 'impacted' || s === 'major' || s === 'critical' || s === 'unavailable') return 'major';
  return 'unknown';
}

/** Convert the xnotify feed into a canonical StatuspageSummary. */
export function xboxToSummary(body: XboxServiceStatus): StatuspageSummary {
  const overallState = body.Status?.Overall?.State ?? 'Unknown';
  const updatedAt = body.Status?.Overall?.LastUpdated ?? null;
  const indicator = indicatorFromState(overallState);

  const impacted = (body.CoreServices || [])
    .map((c) => ({ name: c.Name || 'Service', state: c.Status?.Name || 'None' }))
    .filter((c) => c.state.toLowerCase() !== 'none');

  return {
    page: { name: 'Xbox Live', url: PAGE_URL, updated_at: updatedAt },
    status: {
      indicator,
      description:
        indicator === 'none'
          ? 'All Services Up and Running'
          : `Issues affecting: ${impacted.map((c) => c.name).join(', ') || overallState}`,
    },
    incidents: impacted.map((c) => ({
      name: `${c.name}: ${c.state}`,
      impact: c.state,
      status: 'identified',
      shortlink: PAGE_URL,
      updated_at: updatedAt,
    })),
  };
}

export const xboxProvider: Provider = {
  name: PROVIDER_NAME,

  isAvailable() {
    return true;
  },

  async lookup(_query: string, _type?: LookupType): Promise<ProviderResult<StatusData>> {
    const start = Date.now();
    try {
      const resp = await statusGet(XBOX_STATUS_URL, { headers: { Accept: 'application/json' } });
      const body: XboxServiceStatus =
        typeof resp.data === 'string' ? JSON.parse(resp.data) : resp.data;
      const summary = xboxToSummary(body);
      return {
        provider: PROVIDER_NAME,
        success: true,
        data: summaryToStatusData(summary, PROVIDER_NAME, 'Xbox Live'),
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
