import type { ProviderResult } from '../types/common.js';

/**
 * Key normalization map — maps various API field names to our canonical names.
 * Keys are lowercase for case-insensitive matching.
 */
const KEY_ALIASES: Record<string, string> = {
  // Country
  countrycode: 'country_code',
  country_code2: 'country_code',
  country_iso: 'country_code',
  countryname: 'country',
  country_name: 'country',

  // Region/State
  regionname: 'region',
  region_name: 'region',
  state: 'region',
  stateprov: 'region',
  regioncode: 'region_code',
  region_code: 'region_code',

  // City
  cityname: 'city',
  city_name: 'city',

  // Coordinates
  lat: 'latitude',
  lon: 'longitude',
  lng: 'longitude',

  // Postal
  zip: 'postal_code',
  zipcode: 'postal_code',
  zip_code: 'postal_code',
  postalcode: 'postal_code',

  // Network
  isp_name: 'isp',
  organization: 'org',
  org_name: 'org',
  asn_number: 'asn',
  as_number: 'asn',
  as_name: 'asn_org',
  asname: 'asn_org',
  as_org: 'asn_org',

  // Timezone
  time_zone: 'timezone',
  tz: 'timezone',

  // Phone
  phone_number: 'phone',
  phonenumber: 'phone',
  telefon: 'phone',
  caller_name: 'name',
  callername: 'name',
  display_name: 'name',

  // Address
  street_address: 'street',
  strasse: 'street',
  plz: 'postal_code',
  ort: 'city',
  stadt: 'city',

  // Security/Risk
  is_proxy: 'proxy',
  is_vpn: 'vpn',
  is_tor: 'tor',
  is_tor_node: 'tor',
  is_datacenter: 'datacenter',
  is_crawler: 'crawler',
  is_threat: 'threat',
  risk_score: 'risk_score',
  risk_level: 'risk_level',

  // Email
  is_disposable: 'disposable',
  is_valid: 'valid',
  is_valid_syntax: 'valid_syntax',
  has_mx_records: 'mx_records',
  is_free: 'free_provider',
  role_account: 'role_account',
};

/**
 * Normalize a key name to our canonical format.
 * Converts to lowercase, replaces common aliases.
 */
function normalizeKey(key: string): string {
  const lower = key.toLowerCase().replace(/[- ]/g, '_');
  return KEY_ALIASES[lower] ?? lower;
}

/**
 * Check if a value is "empty" (null, undefined, empty string, empty array, empty object)
 */
function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string' && value.trim() === '') return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') {
    return Object.keys(value as object).length === 0;
  }
  return false;
}

/**
 * Recursively remove empty values from an object or array.
 */
export function deepClean<T>(obj: T): T {
  if (Array.isArray(obj)) {
    return obj
      .map((v) => (typeof v === 'object' ? deepClean(v) : v))
      .filter((v) => !isEmpty(v)) as unknown as T;
  }
  if (obj !== null && typeof obj === 'object') {
    return Object.fromEntries(
      Object.entries(obj as object)
        .map(([k, v]) => [k, typeof v === 'object' ? deepClean(v) : v])
        .filter(([, v]) => !isEmpty(v)),
    ) as unknown as T;
  }
  return obj;
}

/**
 * Smart-merge multiple provider results into a single unified response.
 *
 * Rules:
 * - Normalizes keys across providers
 * - First non-empty value wins (providers are ordered by priority)
 * - Strips null/empty values
 * - Nested objects are merged recursively
 */
export function mergeResponses(results: ProviderResult[]): Record<string, unknown> {
  const merged: Record<string, unknown> = {};

  // Process results in order (first = highest priority)
  for (const result of results) {
    if (!result.success || !result.data) continue;

    for (const [rawKey, value] of Object.entries(result.data)) {
      if (isEmpty(value)) continue;

      const key = normalizeKey(rawKey);

      // If key doesn't exist yet, set it
      if (!(key in merged) || isEmpty(merged[key])) {
        merged[key] = value;
      }
      // If both values are arrays, concatenate them
      else if (Array.isArray(merged[key]) && Array.isArray(value)) {
        merged[key] = [...(merged[key] as unknown[]), ...(value as unknown[])];
      }
      // If both values are objects, merge recursively
      else if (
        typeof merged[key] === 'object' &&
        !Array.isArray(merged[key]) &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        merged[key] !== null &&
        value !== null
      ) {
        merged[key] = {
          ...(value as Record<string, unknown>),
          ...(merged[key] as Record<string, unknown>),
        };
      }
      // Otherwise, keep the existing (higher-priority) value
    }
  }

  // --- Post-processing: remove redundant inferred fields & normalize arrays ---

  // 1. Deduplicate events and sort chronologically oldest-to-newest
  if (Array.isArray(merged.events)) {
    const seen = new Set<string>();
    const dedupedEvents = [];
    for (const event of merged.events) {
      if (event && typeof event === 'object') {
        const ev = event as { date?: string; status?: string; location?: string; courier?: string; source?: string | null };
        const key = `${ev.date || ''}|${ev.status || ''}|${ev.location || ''}`;
        if (!seen.has(key)) {
          seen.add(key);
          dedupedEvents.push(ev);
        }
      }
    }
    // Sort oldest-to-newest
    dedupedEvents.sort((a, b) => new Date(a.date || 0).getTime() - new Date(b.date || 0).getTime());
    merged.events = dedupedEvents;
  }

  // 2. Deduplicate couriers while preserving order (last item is most up-to-date)
  if (Array.isArray(merged.couriers)) {
    const seenCouriers = new Set<string>();
    const dedupedCouriers = [];
    for (const courier of merged.couriers) {
      if (typeof courier === 'string' && courier.trim() !== '') {
        const normalized = courier.trim();
        if (!seenCouriers.has(normalized)) {
          seenCouriers.add(normalized);
          dedupedCouriers.push(normalized);
        }
      }
    }
    merged.couriers = dedupedCouriers;
  }

  // 3. Remove boolean vac_banned if vac_bans_count is present
  if ('vac_bans_count' in merged) {
    delete merged.vac_banned;
  }

  // 2. Remove count keys if associated array is present
  for (const key of Object.keys(merged)) {
    if (key.endsWith('_count') || key.endsWith('Count')) {
      const prefix = key.replace(/_count$|Count$/, '');
      const arrayKeys = [
        prefix,
        `${prefix}s`,
        `${prefix}es`,
        prefix.endsWith('s') ? prefix.slice(0, -1) : prefix,
      ];
      for (const k of arrayKeys) {
        if (k in merged && Array.isArray(merged[k])) {
          delete merged[key];
          break;
        }
      }
    }
  }

  return deepClean(merged);
}

/**
 * Collect errors from all failed providers.
 */
export function collectErrors(results: ProviderResult[]): Record<string, string> {
  const errors: Record<string, string> = {};

  for (const result of results) {
    if (!result.success && result.error) {
      errors[result.provider] = result.error;
    }
  }

  return deepClean(errors);
}

/**
 * Collect raw responses from all providers (for ?raw=true).
 */
export function collectRaw(results: ProviderResult[]): Record<string, unknown> {
  const raw: Record<string, unknown> = {};

  for (const result of results) {
    if (result.raw !== undefined) {
      raw[result.provider] = result.raw;
    }
  }

  return deepClean(raw);
}
