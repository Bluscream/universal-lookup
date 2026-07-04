import { config } from '../../config.js';
import type { LookupType, Provider, ProviderResult, StatusData } from '../../types/common.js';
import { statusGet } from './http.js';
import { type StatuspageSummary, summaryToStatusData } from './statuspage.js';

const PROVIDER_NAME = 'playstation';
const PAGE_URL = 'https://status.playstation.com/';

/**
 * PlayStation Network status is served as region JSON backing status.playstation.com.
 * Region codes: SCEA (Americas), SCEE (Europe), SCEJ (Japan/Asia).
 * A `status` array is empty when the region/country/service is operational and
 * populated during a disruption. We convert it into a canonical StatuspageSummary.
 */
interface PsnService {
  serviceId?: string;
  serviceName?: string;
  status?: unknown[];
}
interface PsnCountry {
  countryCode?: string;
  status?: unknown[];
  services?: PsnService[];
}
interface PsnRegion {
  regionName?: string;
  status?: unknown[];
  countries?: PsnCountry[];
}

/** Convert a PSN region feed into a canonical StatuspageSummary. */
export function psnToSummary(body: PsnRegion, country: string): StatuspageSummary {
  const target =
    (body.countries || []).find(
      (c) => (c.countryCode || '').toUpperCase() === country.toUpperCase(),
    ) || (body.countries || [])[0];

  const impacted = (target?.services || []).filter(
    (s) => Array.isArray(s.status) && s.status.length > 0,
  );
  const regionDisrupted = Array.isArray(body.status) && body.status.length > 0;
  const countryDisrupted = Array.isArray(target?.status) && (target?.status?.length ?? 0) > 0;
  const hasIssues = regionDisrupted || countryDisrupted || impacted.length > 0;

  return {
    page: { name: 'PlayStation Network', url: PAGE_URL, updated_at: null },
    status: {
      indicator: hasIssues ? 'major' : 'none',
      description: hasIssues
        ? `Issues affecting: ${impacted.map((s) => s.serviceName).filter(Boolean).join(', ') || 'PSN services'}`
        : 'All Services Are Up and Running',
    },
    incidents: impacted.map((s) => ({
      name: s.serviceName || s.serviceId || 'PSN service disruption',
      impact: 'major',
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
