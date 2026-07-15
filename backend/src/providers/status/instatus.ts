import type {
  LookupType,
  Provider,
  ProviderResult,
  StatusData,
  MaintenanceWindow,
} from '../../types/common.js';
import { statusGet } from './http.js';
import { type StatuspageSummary, summaryToStatusData } from './statuspage.js';

/**
 * Instatus `summary.json` shape (used by EA and others). Similar spirit to
 * Atlassian Statuspage but with different field/enum names, so we convert it to
 * our canonical StatuspageSummary via {@link instatusToSummary}.
 *
 *   { page: { name, url, status: "UP" | "HASISSUES" | "UNDERMAINTENANCE" },
 *     activeIncidents:   [ { name, url, status, impact } ],
 *     activeMaintenances:[ { name, url, status } ] }
 */
export interface InstatusSummary {
  page?: { name?: string; url?: string; status?: string };
  activeIncidents?: Array<{
    name?: string;
    url?: string;
    status?: string;
    impact?: string;
    started?: string;
  }>;
  activeMaintenances?: Array<{ name?: string; url?: string; status?: string; started?: string }>;
}

/** Map an Instatus incident impact onto a canonical Statuspage indicator. */
function impactToIndicator(impact?: string): string {
  switch ((impact || '').toUpperCase()) {
    case 'MAJOROUTAGE':
      return 'major';
    case 'PARTIALOUTAGE':
    case 'MINOROUTAGE':
    case 'DEGRADEDPERFORMANCE':
      return 'minor';
    case 'UNDERMAINTENANCE':
      return 'maintenance';
    default:
      return 'minor';
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

/** Convert an Instatus summary into our canonical StatuspageSummary. */
export function instatusToSummary(
  body: InstatusSummary,
  name: string,
  url: string,
): StatuspageSummary {
  const pageStatus = (body.page?.status || '').toUpperCase();
  const incidents = body.activeIncidents || [];
  const maintenances = body.activeMaintenances || [];

  let indicator: string;
  if (pageStatus === 'UP') {
    indicator = 'none';
  } else if (pageStatus === 'UNDERMAINTENANCE' && incidents.length === 0) {
    indicator = 'maintenance';
  } else if (incidents.length > 0) {
    // Worst incident impact drives the overall indicator.
    indicator = incidents
      .map((i) => impactToIndicator(i.impact))
      .reduce((a, b) => ((SEVERITY_RANK[b] ?? 1) > (SEVERITY_RANK[a] ?? 1) ? b : a), 'minor');
  } else {
    indicator = pageStatus === '' ? 'unknown' : 'minor';
  }

  return {
    page: { name, url, updated_at: null },
    status: {
      indicator,
      description: indicator === 'none' ? 'All Systems Operational' : 'Service disruption',
    },
    incidents: [
      ...incidents.map((i) => ({
        name: i.name || 'Incident',
        impact: i.impact || null,
        status: i.status || null,
        shortlink: i.url || url,
        started_at: i.started || null,
      })),
      ...maintenances.map((m) => ({
        name: m.name || 'Maintenance',
        impact: 'maintenance',
        status: m.status || null,
        shortlink: m.url || url,
        started_at: m.started || null,
      })),
    ],
  };
}

export interface InstatusProviderOptions {
  service: string;
  label: string;
  url: string;
  maintenanceTimes?: MaintenanceWindow[];
}

/** Build a status Provider backed by an Instatus `summary.json` endpoint. */
export function makeInstatusProvider(opts: InstatusProviderOptions): Provider {
  return {
    name: opts.service,

    isAvailable() {
      return true;
    },

    async lookup(_query: string, _type?: LookupType): Promise<ProviderResult<StatusData>> {
      const start = Date.now();
      try {
        const resp = await statusGet<InstatusSummary>(opts.url);
        const summary = instatusToSummary(
          resp.data || {},
          opts.label,
          opts.url.replace(/\/summary\.json$/, ''),
        );
        return {
          provider: opts.service,
          success: true,
          data: summaryToStatusData(
            summary,
            opts.service,
            opts.label,
            undefined,
            true,
            opts.maintenanceTimes,
          ),
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

/** Services that expose an Instatus `summary.json`. */
export const INSTATUS_SERVICES: InstatusProviderOptions[] = [
  { service: 'ea', label: 'EA', url: 'https://ea.instatus.com/summary.json' },
];
