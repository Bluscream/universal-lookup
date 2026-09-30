import axios from 'axios';
import { config } from '../../config.js';
import type {
  LookupType,
  MaintenanceWindow,
  Provider,
  ProviderResult,
  StatusData,
} from '../../types/common.js';
import { statusGet } from './http.js';
import { type StatuspageSummary, summaryToStatusData } from './statuspage.js';

/**
 * Downdetector API v2 — https://downdetectorapi.com/v2/docs/raw.html
 *
 * The authenticated replacement for the allestörungen scrape. Same underlying
 * data (allestörungen is Downdetector's German site), but served by the vendor's
 * API instead of an HTML page behind a Cloudflare JS challenge that no automated
 * client can clear.
 *
 * Three calls per service, each cached on its own horizon because they change on
 * very different timescales:
 *
 *   POST /tokens?grant_type=client_credentials   -> Bearer JWT, 1 h
 *   GET  /companies/search?slug=…                -> company id, effectively static
 *   GET  /companies/{id}/status                  -> "success"|"warning"|"danger"
 *   GET  /companies/{id}/incidents?only_active=1 -> active incidents
 *
 * A token is shared by every service, so a cold /status/all costs one token
 * call regardless of how many Downdetector services are configured.
 */

const TOKEN_PATH = '/tokens';

/** `POST /tokens` reply. */
interface TokenResponse {
  access_token?: string;
  token_type?: string;
}

/** A company as returned by `/companies/search`. */
interface DowndetectorCompany {
  id?: number;
  name?: string;
  slug?: string;
  url?: string;
  /** 24 h of report counts in 15-minute buckets; the last entry is the newest. */
  stats_24?: number[];
}

/** One entry from `/companies/{id}/incidents`. */
interface DowndetectorIncident {
  id?: number;
  created_at?: string;
  resolved_at?: string | null;
  is_active?: boolean;
  total?: number | null;
  peak_user_impact?: number | null;
}

/**
 * The API's own verdict for a company, one of three strings.
 *
 * `warning` is deliberately mapped to `minor` rather than ignored: unlike the
 * scraped site — which flagged warning over a handful of reports, which is why
 * STATUS_ALLESTOERUNGEN_ESCALATE_ON_WARNING existed — this verdict is computed
 * against the company's own calculated baseline.
 */
const VERDICT_INDICATORS: Record<string, string> = {
  success: 'none',
  warning: 'minor',
  danger: 'major',
};

/* -------------------------------------------------------------------------- */
/* Token                                                                      */
/* -------------------------------------------------------------------------- */

let cachedToken: { token: string; expiresAt: number } | undefined;
/** In-flight token request, so concurrent providers share one call. */
let tokenInFlight: Promise<string> | undefined;

/** Discard the cached token and company ids. Exported for tests. */
export function clearDowndetectorCache(): void {
  cachedToken = undefined;
  tokenInFlight = undefined;
  companyCache.clear();
  statusCache.clear();
}

export function hasDowndetectorCredentials(): boolean {
  return Boolean(config.downdetectorClientId && config.downdetectorClientSecret);
}

/**
 * Fetch a Bearer token, reusing the cached one until it is nearly expired.
 *
 * The vendor documents this call as not counting towards API usage but rate
 * limited, so concurrent callers are collapsed onto a single in-flight request
 * rather than each asking for their own.
 */
async function getToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now) return cachedToken.token;
  if (tokenInFlight) return tokenInFlight;

  tokenInFlight = (async () => {
    try {
      const resp = await axios.post<TokenResponse>(
        `${config.downdetectorBaseUrl}${TOKEN_PATH}`,
        null,
        {
          params: { grant_type: 'client_credentials' },
          timeout: config.serverTimeout,
          auth: {
            username: config.downdetectorClientId,
            password: config.downdetectorClientSecret,
          },
          headers: { Accept: 'application/json' },
        },
      );
      const token = resp.data?.access_token;
      if (!token) throw new Error('Downdetector token response carried no access_token');
      cachedToken = { token, expiresAt: Date.now() + config.downdetectorTokenTtl * 1000 };
      return token;
    } finally {
      // Cleared either way: a failed attempt must not be awaited by the next
      // caller, and a successful one is served from cachedToken from here on.
      tokenInFlight = undefined;
    }
  })();

  return tokenInFlight;
}

/** GET an API path with a Bearer token attached. */
async function apiGet<T>(path: string, params: Record<string, unknown> = {}): Promise<T> {
  const token = await getToken();
  const resp = await statusGet<T>(`${config.downdetectorBaseUrl}${path}`, {
    params,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  return resp.data;
}

/* -------------------------------------------------------------------------- */
/* Company resolution                                                         */
/* -------------------------------------------------------------------------- */

const companyCache = new Map<string, { company: DowndetectorCompany; expiresAt: number }>();

/**
 * Resolve a Downdetector slug to a company.
 *
 * Ids are per-site, so the search is scoped by country. Cached for a day:
 * a company's id does not change, and paying a search call per service on every
 * lookup would triple the request count for nothing.
 */
async function resolveCompany(slug: string): Promise<DowndetectorCompany> {
  const key = `${config.downdetectorCountry}:${slug}`;
  const hit = companyCache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.company;

  const results = await apiGet<DowndetectorCompany[]>('/companies/search', {
    slug,
    country: config.downdetectorCountry,
    fields: 'id,name,slug,url,stats_24',
  });
  const company = (results || []).find((c) => c.slug === slug) ?? (results || [])[0];
  if (!company?.id) throw new Error(`No Downdetector company for slug "${slug}"`);

  companyCache.set(key, {
    company,
    expiresAt: Date.now() + config.downdetectorCompanyTtl * 1000,
  });
  return company;
}

/* -------------------------------------------------------------------------- */
/* Status                                                                     */
/* -------------------------------------------------------------------------- */

interface Reading {
  company: DowndetectorCompany;
  verdict: string;
  incidents: DowndetectorIncident[];
  reports: number | undefined;
}

const statusCache = new Map<string, { reading: Reading; expiresAt: number }>();

/**
 * Most recent report count, taken from the tail of the 24 h series.
 *
 * `stats_60` exists but is documented as deprecated, and the dedicated
 * `last_15` endpoint would be a fourth call per service for a number the
 * company payload already carries.
 */
function latestReports(company: DowndetectorCompany): number | undefined {
  const series = company.stats_24;
  if (!Array.isArray(series) || series.length === 0) return undefined;
  const last = series[series.length - 1];
  return typeof last === 'number' ? last : undefined;
}

/** Fetch a service's current reading, cached briefly. */
async function getReading(slug: string): Promise<Reading> {
  const hit = statusCache.get(slug);
  if (hit && hit.expiresAt > Date.now()) return hit.reading;

  const company = await resolveCompany(slug);
  // The two calls are independent, so they go out together rather than adding
  // a second round trip per service to a fan-out that already has many.
  const [verdictRaw, incidentsRaw] = await Promise.all([
    apiGet<string>(`/companies/${company.id}/status`),
    apiGet<DowndetectorIncident[]>(`/companies/${company.id}/incidents`, { only_active: true }),
  ]);

  const reading: Reading = {
    company,
    verdict: typeof verdictRaw === 'string' ? verdictRaw.toLowerCase() : '',
    incidents: Array.isArray(incidentsRaw) ? incidentsRaw.filter((i) => i.is_active !== false) : [],
    reports: latestReports(company),
  };
  statusCache.set(slug, { reading, expiresAt: Date.now() + config.downdetectorTtl * 1000 });
  return reading;
}

/**
 * Turn a reading into the canonical summary every status provider emits, so it
 * flows through `summaryToStatusData` like any operator feed.
 */
export function readingToSummary(reading: Reading, label: string): StatuspageSummary {
  const { company, verdict, incidents, reports } = reading;
  const pageUrl = company.url || statusPageUrl(company.slug || '');

  let indicator = VERDICT_INDICATORS[verdict];
  if (indicator === undefined) {
    // No verdict from the API — fall back to the report count so a missing
    // field degrades to a usable reading rather than to "unknown".
    indicator =
      reports !== undefined && reports >= config.downdetectorMinReports ? 'minor' : 'unknown';
  }

  return {
    page: { name: label, url: pageUrl, updated_at: null },
    status: { indicator },
    incidents: incidents.map((incident) => ({
      name:
        incident.total != null
          ? `User reports indicate problems (${incident.total} reports)`
          : 'User reports indicate problems',
      impact: indicator === 'major' ? 'major' : 'minor',
      status: 'investigating',
      shortlink: pageUrl,
      started_at: incident.created_at || null,
    })),
  };
}

/** Public status page for a slug on the configured Downdetector site. */
export function statusPageUrl(slug: string): string {
  const site = config.downdetectorCountry === 'de' ? 'xn--allestrungen-9ib.de' : 'downdetector.com';
  return `https://${site}/status/${slug}/`;
}

/* -------------------------------------------------------------------------- */
/* Provider                                                                   */
/* -------------------------------------------------------------------------- */

export interface DowndetectorProviderOptions {
  service: string;
  slug: string;
  label?: string;
  icon?: string;
  category?: string;
  maintenanceTimes?: MaintenanceWindow[];
}

/** Build a status Provider backed by the Downdetector API. */
export function makeDowndetectorProvider(opts: DowndetectorProviderOptions): Provider {
  const label = opts.label || opts.slug;
  return {
    name: opts.service,

    isAvailable() {
      // Credentials are a paid subscription; without them the provider is
      // skipped rather than failing every lookup.
      return hasDowndetectorCredentials();
    },

    async lookup(_query: string, _type?: LookupType): Promise<ProviderResult<StatusData>> {
      const start = Date.now();
      try {
        const reading = await getReading(opts.slug);
        const summary = readingToSummary(reading, reading.company.name || label);
        return {
          provider: opts.service,
          success: true,
          data: summaryToStatusData(
            summary,
            opts.service,
            label,
            undefined,
            false,
            opts.maintenanceTimes,
            opts.category,
            undefined,
            opts.icon,
          ),
          raw: reading,
          duration: Date.now() - start,
        };
      } catch (error) {
        // 401 means the credentials or the token were rejected, which is worth
        // distinguishing from an ordinary upstream failure: every service will
        // report it at once and the remedy is configuration, not a retry.
        const status = axios.isAxiosError(error) ? error.response?.status : undefined;
        const message =
          status === 401 || status === 403
            ? `Downdetector rejected the credentials (HTTP ${status}) — check DOWNDETECTOR_CLIENT_ID/SECRET`
            : error instanceof Error
              ? error.message
              : String(error);
        return {
          provider: opts.service,
          success: false,
          data: {},
          error: message,
          duration: Date.now() - start,
        };
      }
    },
  };
}

/**
 * Parse `DOWNDETECTOR_SERVICES`.
 *
 * Deliberately the same `slug=Label=icon=Category` grammar as
 * STATUS_ALLESTOERUNGEN_SERVICES, so a service list can be moved from one to
 * the other unchanged.
 */
export function parseDowndetectorSpecs(raw: string): DowndetectorProviderOptions[] {
  const out: DowndetectorProviderOptions[] = [];
  const seen = new Set<string>();
  for (const entry of (raw || '').split(',')) {
    const [slugPart, labelPart, iconPart, categoryPart] = entry.split('=').map((s) => s.trim());
    const slug = (slugPart || '').toLowerCase();
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    out.push({
      service: slug,
      slug,
      label: labelPart || undefined,
      icon: iconPart || undefined,
      category: categoryPart || undefined,
    });
  }
  return out;
}

/** Services read from the Downdetector API, from DOWNDETECTOR_SERVICES. */
export const DOWNDETECTOR_SERVICES: DowndetectorProviderOptions[] = parseDowndetectorSpecs(
  config.downdetectorServices,
);
