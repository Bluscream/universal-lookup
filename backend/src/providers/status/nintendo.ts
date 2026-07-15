import { config } from '../../config.js';
import type { LookupType, Provider, ProviderResult, StatusData } from '../../types/common.js';
import { statusGet } from './http.js';
import { type StatuspageSummary, summaryToStatusData } from './statuspage.js';

const PROVIDER_NAME = 'nintendo';

/**
 * Nintendo's network status feed backing nintendo.co.jp/netinfo. Empty
 * `operational_statuses` and `temporary_maintenances` arrays mean everything is
 * up; entries represent active outages / maintenance windows.
 *
 *   { categories: [ { name: "Nintendo Switch" } ],
 *     operational_statuses: [ … ], temporary_maintenances: [ … ] }
 */
interface NintendoEntry {
  platform?: string[];
  software_title?: string;
  services?: string;
  message?: string;
  begin?: string;
  end?: string;
}
interface NintendoStatus {
  operational_statuses?: NintendoEntry[];
  temporary_maintenances?: NintendoEntry[];
}

function pageUrl(): string {
  return `https://www.nintendo.co.jp/netinfo/${config.statusNintendoLocale}/index.html`;
}

function entryName(e: NintendoEntry): string {
  return (
    e.software_title ||
    (Array.isArray(e.platform) && e.platform.length ? e.platform.join(', ') : '') ||
    e.services ||
    e.message ||
    'Nintendo service'
  );
}

function parseNintendoDate(d?: string): string | null {
  if (!d) return null;
  // Nintendo sometimes includes spaces around colons, e.g. "10 :55 PM"
  const cleaned = d.replace(/\s*:\s*/g, ':');
  const parsed = new Date(cleaned);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/** Convert the Nintendo netinfo feed into a canonical StatuspageSummary. */
export function nintendoToSummary(body: NintendoStatus): StatuspageSummary {
  const outages = body.operational_statuses || [];
  const maintenances = body.temporary_maintenances || [];
  const indicator = outages.length > 0 ? 'major' : maintenances.length > 0 ? 'maintenance' : 'none';

  return {
    page: { name: 'Nintendo', url: pageUrl(), updated_at: null },
    status: {
      indicator,
      description:
        indicator === 'none'
          ? 'All Systems Operational'
          : `${outages.length} outage(s), ${maintenances.length} maintenance(s)`,
    },
    incidents: [
      ...outages.map((e) => ({
        name: entryName(e),
        impact: 'major',
        status: 'identified',
        shortlink: pageUrl(),
        started_at: parseNintendoDate(e.begin),
        updated_at: parseNintendoDate(e.begin),
      })),
      ...maintenances.map((e) => ({
        name: `${entryName(e)} (maintenance)`,
        impact: 'maintenance',
        status: 'scheduled',
        shortlink: pageUrl(),
        started_at: parseNintendoDate(e.begin),
        updated_at: parseNintendoDate(e.begin),
        scheduled_until: parseNintendoDate(e.end),
      })),
    ],
  };
}

export const nintendoProvider: Provider = {
  name: PROVIDER_NAME,

  isAvailable() {
    return true;
  },

  async lookup(_query: string, _type?: LookupType): Promise<ProviderResult<StatusData>> {
    const start = Date.now();
    const url = `https://www.nintendo.co.jp/netinfo/${config.statusNintendoLocale}/status.json?_=${Date.now()}`;
    try {
      const resp = await statusGet<NintendoStatus>(url, {
        headers: { 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json' },
      });
      const body: NintendoStatus =
        typeof resp.data === 'string' ? JSON.parse(resp.data) : resp.data;
      const summary = nintendoToSummary(body);
      return {
        provider: PROVIDER_NAME,
        success: true,
        data: summaryToStatusData(summary, PROVIDER_NAME, 'Nintendo'),
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
