import { config } from '../../config.js';
import type { LookupType, Provider, ProviderResult, StatusData } from '../../types/common.js';
import { statusGet } from './http.js';
import { type StatuspageSummary, summaryToStatusData } from './statuspage.js';

const PROVIDER_NAME = 'playstation';
const PAGE_URL = 'https://status.playstation.com/';

/**
 * PlayStation Network status is served as region JSON backing status.playstation.com.
 * Region codes: SCEA (Americas), SCEE (Europe), SCEJ (Japan/Asia).
 *
 * A service's `status` array holds entries only when there is (or was) an event.
 * Each entry has a `statusType` ("Outage" / "Maintenance") and start/end dates.
 * The feed keeps resolved and scheduled/future entries too, so a non-empty array
 * does NOT mean "currently down" — we only count entries that are an Outage or
 * Maintenance and whose time window is currently active.
 */
interface PsnStatusEntry {
  statusType?: string;
  startDate?: string;
  endDate?: string;
}
interface PsnService {
  serviceId?: string;
  serviceName?: string;
  status?: PsnStatusEntry[];
}
interface PsnCountry {
  countryCode?: string;
  status?: PsnStatusEntry[];
  services?: PsnService[];
}
interface PsnRegion {
  regionName?: string;
  status?: PsnStatusEntry[];
  countries?: PsnCountry[];
}

/** The kind of active disruption an entry represents, or null if not active. */
function activeKind(entry: PsnStatusEntry, now: number): 'outage' | 'maintenance' | null {
  const type = (entry.statusType || '').toLowerCase();
  if (type !== 'outage' && type !== 'maintenance') return null;
  const start = entry.startDate ? Date.parse(entry.startDate) : Number.NaN;
  const end = entry.endDate ? Date.parse(entry.endDate) : Number.NaN;
  if (!Number.isNaN(start) && start > now) return null; // scheduled / not started
  if (!Number.isNaN(end) && end < now) return null; // already ended / resolved
  return type as 'outage' | 'maintenance';
}

/** Worst active disruption across a status array. */
function worstKind(entries: PsnStatusEntry[] | undefined, now: number): 'outage' | 'maintenance' | null {
  let kind: 'outage' | 'maintenance' | null = null;
  for (const e of entries || []) {
    const k = activeKind(e, now);
    if (k === 'outage') return 'outage';
    if (k === 'maintenance') kind = 'maintenance';
  }
  return kind;
}

/** Convert a PSN region feed into a canonical StatuspageSummary. */
export function psnToSummary(body: PsnRegion, country: string, now: number = Date.now()): StatuspageSummary {
  const target =
    (body.countries || []).find(
      (c) => (c.countryCode || '').toUpperCase() === country.toUpperCase(),
    ) || (body.countries || [])[0];

  const impacted = (target?.services || [])
    .map((s) => ({ service: s, kind: worstKind(s.status, now) }))
    .filter((x): x is { service: PsnService; kind: 'outage' | 'maintenance' } => x.kind !== null);

  const regionKind = worstKind(body.status, now);
  const countryKind = worstKind(target?.status, now);
  const anyOutage =
    regionKind === 'outage' ||
    countryKind === 'outage' ||
    impacted.some((x) => x.kind === 'outage');
  const anyIssue = regionKind || countryKind || impacted.length > 0;

  const indicator = anyOutage ? 'major' : anyIssue ? 'maintenance' : 'none';

  return {
    page: { name: 'PlayStation Network', url: PAGE_URL, updated_at: null },
    status: {
      indicator,
      description:
        indicator === 'none'
          ? 'All Services Are Up and Running'
          : `${indicator === 'major' ? 'Issues' : 'Maintenance'} affecting: ${impacted.map((x) => x.service.serviceName).filter(Boolean).join(', ') || 'PSN services'}`,
    },
    incidents: impacted.map((x) => ({
      name: x.service.serviceName || x.service.serviceId || 'PSN service disruption',
      impact: x.kind === 'outage' ? 'major' : 'maintenance',
      status: 'identified',
      shortlink: PAGE_URL,
    })),
  };
}

export const playstationProvider: Provider = {
  name: PROVIDER_NAME,

  isAvailable() {
    return true;
  },

  async lookup(_query: string, _type?: LookupType): Promise<ProviderResult<StatusData>> {
    const start = Date.now();
    const region = config.statusPsnRegion;
    const url = `https://status.playstation.com/data/statuses/region/${region}.json`;
    try {
      const resp = await statusGet<PsnRegion>(url);
      const summary = psnToSummary(resp.data || {}, config.statusPsnCountry);
      return {
        provider: PROVIDER_NAME,
        success: true,
        data: summaryToStatusData(summary, PROVIDER_NAME, 'PlayStation Network'),
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
