import type { StatusData, StatusIncident, StatusIndicator, StatusServiceEntry } from '../../types/common.js';

/**
 * Export the unified {@link StatusData} as a single Atlassian Statuspage v2
 * `summary.json` document, so `?format=statuspage` output is byte-compatible
 * with anything that already parses a real Statuspage feed.
 *
 * Each monitored service becomes one **component**; every active incident
 * becomes one **incident**. Only enum values that the Atlassian schema permits
 * are emitted, so strict parsers won't trip.
 *
 * Reference: https://www.atlassian.com/software/statuspage (Status API v2).
 * NOTE: Only Atlassian Statuspage output is supported.
 */

/** Valid Atlassian component statuses. */
type ComponentStatus =
  | 'operational'
  | 'degraded_performance'
  | 'partial_outage'
  | 'major_outage'
  | 'under_maintenance';

/** Valid Atlassian page-level status indicators. */
type PageIndicator = 'none' | 'minor' | 'major' | 'critical' | 'maintenance';

/** Valid Atlassian incident impacts. */
type IncidentImpact = 'none' | 'minor' | 'major' | 'critical';

/** Valid Atlassian incident statuses. */
type IncidentStatus = 'investigating' | 'identified' | 'monitoring' | 'resolved' | 'postmortem';

export interface StatuspageComponent {
  id: string;
  name: string;
  status: ComponentStatus;
  created_at: string;
  updated_at: string;
  position: number;
  description: string | null;
  showcase: boolean;
  start_date: string | null;
  group_id: string | null;
  page_id: string;
  group: boolean;
  only_show_if_degraded: boolean;
}

export interface StatuspageIncidentUpdate {
  id: string;
  status: IncidentStatus;
  body: string;
  incident_id: string;
  created_at: string;
  updated_at: string;
  display_at: string;
  affected_components: Array<{ code: string; name: string; old_status: string; new_status: string }>;
  deliver_notifications: boolean;
  custom_tweet: string | null;
  tweet_id: string | null;
}

export interface StatuspageIncident {
  id: string;
  name: string;
  status: IncidentStatus;
  created_at: string;
  updated_at: string;
  monitoring_at: string | null;
  resolved_at: string | null;
  impact: IncidentImpact;
  shortlink: string;
  started_at: string;
  page_id: string;
  incident_updates: StatuspageIncidentUpdate[];
  components: StatuspageComponent[];
}

export interface StatuspageSummaryExport {
  page: {
    id: string;
    name: string;
    url: string;
    time_zone: string;
    updated_at: string;
  };
  status: {
    indicator: PageIndicator;
    description: string;
  };
  components: StatuspageComponent[];
  incidents: StatuspageIncident[];
  scheduled_maintenances: unknown[];
}

/** Severity ordering for computing the worst overall indicator. */
const SEVERITY_RANK: Record<StatusIndicator, number> = {
  none: 0,
  maintenance: 1,
  unknown: 1,
  minor: 2,
  major: 3,
  critical: 4,
};

/** Atlassian's default page descriptions per indicator. */
const PAGE_DESCRIPTION: Record<PageIndicator, string> = {
  none: 'All Systems Operational',
  minor: 'Minor Service Outage',
  major: 'Partial System Outage',
  critical: 'Major Service Outage',
  maintenance: 'Service Under Maintenance',
};

/** Map our canonical indicator to a valid Atlassian component status. */
function componentStatus(indicator: StatusIndicator): ComponentStatus {
  switch (indicator) {
    case 'none':
      return 'operational';
    case 'minor':
      return 'partial_outage';
    case 'major':
    case 'critical':
      return 'major_outage';
    case 'maintenance':
      return 'under_maintenance';
    default:
      return 'operational';
  }
}

/** Map our canonical indicator to a valid Atlassian page indicator. */
function pageIndicator(indicator: StatusIndicator): PageIndicator {
  switch (indicator) {
    case 'minor':
      return 'minor';
    case 'major':
      return 'major';
    case 'critical':
      return 'critical';
    case 'maintenance':
      return 'maintenance';
    default:
      return 'none';
  }
}

/** Coerce an arbitrary incident impact string into a valid Atlassian impact. */
function incidentImpact(impact?: string | null): IncidentImpact {
  switch ((impact || '').toLowerCase()) {
    case 'minor':
      return 'minor';
    case 'major':
      return 'major';
    case 'critical':
    case 'offline':
      return 'critical';
    default:
      return 'none';
  }
}

/** Coerce an arbitrary incident status string into a valid Atlassian status. */
function incidentStatus(status?: string | null): IncidentStatus {
  switch ((status || '').toLowerCase()) {
    case 'identified':
      return 'identified';
    case 'monitoring':
      return 'monitoring';
    case 'resolved':
      return 'resolved';
    case 'postmortem':
      return 'postmortem';
    default:
      return 'investigating';
  }
}

/** Deterministic 12-hex-char id from a string (FNV-1a), for stable component/incident ids. */
function stableId(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // Widen to 12 hex chars by mixing a second pass.
  let h2 = h ^ 0xdeadbeef;
  for (let i = input.length - 1; i >= 0; i--) {
    h2 ^= input.charCodeAt(i);
    h2 = Math.imul(h2, 0x01000193);
  }
  const hex = (n: number) => (n >>> 0).toString(16).padStart(8, '0');
  return (hex(h) + hex(h2)).slice(0, 12);
}

export interface StatuspageExportOptions {
  /** Public URL of this status page (e.g. https://lookup.minopia.de). */
  pageUrl: string;
  /** Human-friendly page name. */
  pageName?: string;
  /** Stable page id (defaults to one derived from pageUrl). */
  pageId?: string;
}

/**
 * Convert unified {@link StatusData} into an Atlassian Statuspage v2 summary.
 */
export function statusDataToStatuspageSummary(
  data: StatusData,
  opts: StatuspageExportOptions,
): StatuspageSummaryExport {
  const now = new Date().toISOString();
  const pageId = opts.pageId || stableId(opts.pageUrl);
  const pageName = opts.pageName || 'Universal Lookup Status';

  const services: StatusServiceEntry[] = Array.isArray(data.services) ? data.services : [];
  const incidents: StatusIncident[] = Array.isArray(data.incidents) ? data.incidents : [];

  // Components (one per service), stable-sorted by position of appearance.
  const components: StatuspageComponent[] = services.map((svc, index) => {
    const updated = svc.updated_at || now;
    return {
      id: stableId(`component:${svc.service}`),
      name: svc.name,
      status: componentStatus(svc.indicator),
      created_at: updated,
      updated_at: updated,
      position: index + 1,
      description: null,
      showcase: false,
      start_date: null,
      group_id: null,
      page_id: pageId,
      group: false,
      only_show_if_degraded: false,
    };
  });

  const componentByService = new Map<string, StatuspageComponent>();
  services.forEach((svc, index) => componentByService.set(svc.service, components[index]));

  // Incidents (only unresolved ones are present in StatusData).
  const spIncidents: StatuspageIncident[] = incidents.map((inc) => {
    const started = inc.started_at || inc.updated_at || now;
    const updated = inc.updated_at || started;
    const status = incidentStatus(inc.status);
    const id = stableId(`incident:${inc.url || `${inc.service}:${inc.name}`}`);
    const affected = componentByService.get(inc.service);

    return {
      id,
      name: inc.name,
      status,
      created_at: started,
      updated_at: updated,
      monitoring_at: status === 'monitoring' ? updated : null,
      resolved_at: null,
      impact: incidentImpact(inc.impact),
      shortlink: inc.url || opts.pageUrl,
      started_at: started,
      page_id: pageId,
      incident_updates: [
        {
          id: stableId(`update:${id}`),
          status,
          body: inc.name,
          incident_id: id,
          created_at: updated,
          updated_at: updated,
          display_at: updated,
          affected_components: affected
            ? [
                {
                  code: affected.id,
                  name: affected.name,
                  old_status: 'operational',
                  new_status: affected.status,
                },
              ]
            : [],
          deliver_notifications: true,
          custom_tweet: null,
          tweet_id: null,
        },
      ],
      components: affected ? [affected] : [],
    };
  });

  // Overall indicator = worst across all services.
  let worst: StatusIndicator = 'none';
  for (const svc of services) {
    if ((SEVERITY_RANK[svc.indicator] ?? 0) > (SEVERITY_RANK[worst] ?? 0)) {
      worst = svc.indicator;
    }
  }
  const indicator = pageIndicator(worst);

  // Page updated_at = most recent component update.
  const pageUpdated =
    components.reduce<string>((latest, c) => (c.updated_at > latest ? c.updated_at : latest), '') ||
    now;

  return {
    page: {
      id: pageId,
      name: pageName,
      url: opts.pageUrl,
      time_zone: 'Etc/UTC',
      updated_at: pageUpdated,
    },
    status: {
      indicator,
      description: PAGE_DESCRIPTION[indicator],
    },
    components,
    incidents: spIncidents,
    scheduled_maintenances: [],
  };
}
