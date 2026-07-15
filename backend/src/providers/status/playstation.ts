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
  statusId?: string;
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
function worstKind(
  entries: PsnStatusEntry[] | undefined,
  now: number,
): 'outage' | 'maintenance' | null {
  let kind: 'outage' | 'maintenance' | null = null;
  for (const e of entries || []) {
    const k = activeKind(e, now);
    if (k === 'outage') return 'outage';
    if (k === 'maintenance') kind = 'maintenance';
  }
  return kind;
}

/**
 * Convert PSN region feeds into a canonical StatuspageSummary.
 *
 * By default (country empty or "all"/"global"/"world") the overall status is
 * GLOBAL: any active disruption anywhere marks PSN as affected. Passing a
 * specific country code narrows the overall status to that country (an outage
 * elsewhere then won't mark PSN "down" for you). Either way the incidents list
 * covers EVERY active disruption across all fetched countries/regions — deduped
 * by statusId and labelled with the affected country.
 */
export function psnToSummary(
  input: PsnRegion | PsnRegion[],
  country: string,
  now: number = Date.now(),
): StatuspageSummary {
  const bodies = Array.isArray(input) ? input : [input];
  const cc = country.trim().toUpperCase();
  const isGlobal = cc === '' || cc === 'ALL' || cc === 'GLOBAL' || cc === 'WORLD';

  // ---- Incidents: every active disruption across all countries, deduped ----
  const seen = new Map<string, { name: string; countries: Set<string>; outage: boolean }>();
  for (const b of bodies) {
    for (const c of b.countries || []) {
      for (const s of c.services || []) {
        for (const e of s.status || []) {
          const kind = activeKind(e, now);
          if (!kind) continue;
          const id = e.statusId || `${s.serviceName || s.serviceId || ''}|${e.startDate || ''}`;
          const rec = seen.get(id) || {
            name: s.serviceName || s.serviceId || 'PSN service',
            countries: new Set<string>(),
            outage: false,
          };
          if (c.countryCode) rec.countries.add(c.countryCode);
          if (kind === 'outage') rec.outage = true;
          seen.set(id, rec);
        }
      }
    }
  }
  const incidents = [...seen.values()].map((r) => {
    const list = [...r.countries];
    const where =
      list.length === 0
        ? ''
        : list.length <= 4
          ? ` (${list.join(', ')})`
          : ` (${list.length} countries)`;
    return {
      name: `${r.name}${where}`,
      impact: r.outage ? 'major' : 'maintenance',
      status: 'identified',
      shortlink: PAGE_URL,
    };
  });

  // ---- Overall status ----
  let indicator: string;
  let description: string;

  if (isGlobal) {
    // Global: any active disruption anywhere counts.
    const anyOutage = [...seen.values()].some((r) => r.outage);
    indicator = anyOutage ? 'major' : seen.size > 0 ? 'maintenance' : 'none';
    if (indicator === 'none') description = 'All Systems Operational';
    else {
      const noun = anyOutage ? 'issue' : 'maintenance event';
      description = `${seen.size} active ${noun}${seen.size === 1 ? '' : 's'}`;
    }
  } else {
    // Country mode: only the target country drives the overall status.
    const myImpacted = (target(bodies, cc)?.services || [])
      .map((s) => ({ service: s, kind: worstKind(s.status, now) }))
      .filter((x): x is { service: PsnService; kind: 'outage' | 'maintenance' } => x.kind !== null);
    const myCountryKind = worstKind(target(bodies, cc)?.status, now);
    const meOutage = myCountryKind === 'outage' || myImpacted.some((x) => x.kind === 'outage');
    const meIssue = myCountryKind || myImpacted.length > 0;
    indicator = meOutage ? 'major' : meIssue ? 'maintenance' : 'none';

    const myLabels = myImpacted
      .map((x) => x.service.serviceName)
      .filter(Boolean)
      .join(', ');
    if (indicator === 'major') description = `Issues affecting: ${myLabels || 'PSN services'}`;
    else if (indicator === 'maintenance')
      description = `Maintenance affecting: ${myLabels || 'PSN services'}`;
    else if (incidents.length > 0)
      description = `All Systems Operational (${incidents.length} issue${incidents.length === 1 ? '' : 's'} elsewhere)`;
    else description = 'All Systems Operational';
  }

  return {
    page: { name: 'PlayStation Network', url: PAGE_URL, updated_at: null },
    status: { indicator, description },
    incidents,
  };
}

/** Find the country entry matching a country code across all region bodies. */
function target(bodies: PsnRegion[], cc: string) {
  return bodies
    .flatMap((b) => b.countries || [])
    .find((c) => (c.countryCode || '').toUpperCase() === cc);
}

export const playstationProvider: Provider = {
  name: PROVIDER_NAME,

  isAvailable() {
    return true;
  },

  async lookup(_query: string, _type?: LookupType): Promise<ProviderResult<StatusData>> {
    const start = Date.now();
    // STATUS_PSN_REGION may be a single region, a comma-separated list, or "all".
    const cfg = (config.statusPsnRegion || 'SCEA').trim();
    const regions =
      cfg.toLowerCase() === 'all'
        ? ['SCEA', 'SCEE', 'SCEJ']
        : cfg
            .split(',')
            .map((r) => r.trim())
            .filter(Boolean);
    try {
      const bodies: PsnRegion[] = [];
      for (const r of regions) {
        try {
          const resp = await statusGet<PsnRegion>(
            `https://status.playstation.com/data/statuses/region/${r}.json`,
          );
          if (resp.data) bodies.push(resp.data);
        } catch {
          // skip regions that fail (e.g. SCEJ sometimes 404s)
        }
      }
      const summary = psnToSummary(bodies, config.statusPsnCountry);
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
