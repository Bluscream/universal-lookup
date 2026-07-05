import type { LookupType, Provider, ProviderResult, StatusData } from '../../types/common.js';
import { statusGet } from './http.js';
import { type StatuspageSummary, summaryToStatusData } from './statuspage.js';

const PROVIDER_NAME = 'gcp';
const PAGE_URL = 'https://status.cloud.google.com/';

/**
 * Google Cloud publishes a flat incidents feed. Each incident has `begin`/`end`
 * and a `severity`; an incident is currently active when it has no `end` (or a
 * future one). Resolved incidents stay in the feed, so we must filter by time.
 */
const GCP_URL = 'https://status.cloud.google.com/incidents.json';

interface GcpIncident {
  external_desc?: string;
  service_name?: string;
  severity?: string;
  begin?: string;
  end?: string;
  uri?: string;
}

/** Convert the GCP incidents feed into a canonical StatuspageSummary. */
export function gcpToSummary(incidents: GcpIncident[], now: number = Date.now()): StatuspageSummary {
  const active = (incidents || []).filter((i) => {
    const end = i.end ? Date.parse(i.end) : Number.NaN;
    return Number.isNaN(end) || end > now; // no end, or ends in the future = ongoing
  });
  const anyHigh = active.some((i) => (i.severity || '').toLowerCase() === 'high');
  const indicator = active.length === 0 ? 'none' : anyHigh ? 'major' : 'minor';

  return {
    page: { name: 'Google Cloud', url: PAGE_URL, updated_at: null },
    status: {
      indicator,
      description:
        indicator === 'none'
          ? 'All Systems Operational'
          : `${active.length} active incident${active.length === 1 ? '' : 's'}`,
    },
    incidents: active.map((i) => ({
      name: `${i.service_name ? `${i.service_name}: ` : ''}${i.external_desc || 'Incident'}`,
      impact: (i.severity || '').toLowerCase() === 'high' ? 'major' : 'minor',
      status: 'identified',
      shortlink: i.uri ? `${PAGE_URL.replace(/\/$/, '')}${i.uri.startsWith('/') ? '' : '/'}${i.uri}` : PAGE_URL,
      started_at: i.begin || null,
    })),
  };
}

export const gcpProvider: Provider = {
  name: PROVIDER_NAME,

  isAvailable() {
    return true;
  },

  async lookup(_query: string, _type?: LookupType): Promise<ProviderResult<StatusData>> {
    const start = Date.now();
    try {
      const resp = await statusGet<GcpIncident[]>(GCP_URL);
      const summary = gcpToSummary(Array.isArray(resp.data) ? resp.data : []);
      return {
        provider: PROVIDER_NAME,
        success: true,
        data: summaryToStatusData(summary, PROVIDER_NAME, 'Google Cloud'),
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
