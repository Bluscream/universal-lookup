import axios from 'axios';
import { config } from '../../config.js';
import { normalizeLocation } from '../../lib/normalizer.js';

/**
 * Shared geocoding for the location providers.
 *
 * The warning and weather providers all need coordinates, but a lookup arrives
 * as free text ("Wiesbaden", "65183", "50.08,8.24") and the registry fans out in
 * parallel, so none of them can read the nominatim provider's answer. They call
 * in here instead, and the cache means one Nominatim request serves all of them
 * — which also keeps us inside Nominatim's 1 req/s usage policy.
 */

const NOMINATIM = 'https://nominatim.openstreetmap.org';
const USER_AGENT = 'universal-lookup/1.0 (https://github.com/Bluscream/universal-lookup)';

export interface GeoPlace {
  latitude: number;
  longitude: number;
  display_name?: string;
  city?: string;
  state?: string;
  /** ISO 3166-2 subdivision without the country prefix, e.g. "HE" for Hessen. */
  state_code?: string;
  postal_code?: string;
  /** Lowercase ISO 3166-1 alpha-2, e.g. "de". */
  country_code?: string;
  /**
   * Amtlicher Regionalschlüssel — the 12-digit German regional key, from OSM's
   * `de:regionalschluessel` tag. NINA keys its per-district feed by this, so
   * having it is the difference between an exact answer and a state-wide one.
   */
  ars?: string;
}

interface CacheEntry {
  place: GeoPlace | null;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

/**
 * Lookups in flight, keyed the same as the cache.
 *
 * A cache alone is not enough: the providers fan out in *parallel* with the same
 * query, so all of them miss the empty cache at once and each makes its own
 * request — three requests per lookup against a service that asks for one per
 * second. Collapsing onto one promise is what actually holds that policy.
 */
const inFlight = new Map<string, Promise<GeoPlace | null>>();

/** Drop the cache. Tests use this; nothing in the server does. */
export function clearGeoCache(): void {
  cache.clear();
  inFlight.clear();
}

/** Resolve `key` through the cache, collapsing concurrent callers onto one fetch. */
async function shared(
  key: string,
  fetch: () => Promise<GeoPlace | null>,
): Promise<GeoPlace | null> {
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.place;

  const pending = inFlight.get(key);
  if (pending) return pending;

  const task = (async () => {
    try {
      const place = await fetch();
      cache.set(key, { place, expiresAt: Date.now() + config.locationGeocodeTtl * 1000 });
      return place;
    } finally {
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, task);
  return task;
}

interface NominatimAddress {
  city?: string;
  town?: string;
  village?: string;
  municipality?: string;
  state?: string;
  postcode?: string;
  country_code?: string;
  [key: string]: string | undefined;
}

interface NominatimPlace {
  lat?: string;
  lon?: string;
  display_name?: string;
  address?: NominatimAddress;
  extratags?: Record<string, string> | null;
}

function subdivision(address: NominatimAddress | undefined): string | undefined {
  // Nominatim reports it as ISO3166-2-lvl4 / -lvl6 depending on the country.
  for (const [key, value] of Object.entries(address ?? {})) {
    if (key.startsWith('ISO3166-2') && value) return value.split('-').pop();
  }
  return undefined;
}

function toPlace(raw: NominatimPlace): GeoPlace | null {
  const latitude = Number.parseFloat(raw.lat ?? '');
  const longitude = Number.parseFloat(raw.lon ?? '');
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  const address = raw.address;
  return {
    latitude,
    longitude,
    display_name: raw.display_name,
    city: address?.city || address?.town || address?.village || address?.municipality,
    state: address?.state,
    state_code: subdivision(address),
    postal_code: address?.postcode,
    country_code: address?.country_code?.toLowerCase(),
    ars: raw.extratags?.['de:regionalschluessel'],
  };
}

async function nominatim(path: string, params: Record<string, string>): Promise<NominatimPlace[]> {
  const resp = await axios.get(`${NOMINATIM}${path}`, {
    params: { format: 'json', addressdetails: '1', extratags: '1', ...params },
    timeout: config.serverTimeout,
    headers: { 'User-Agent': USER_AGENT },
  });
  const data: unknown = resp.data;
  return Array.isArray(data) ? (data as NominatimPlace[]) : [data as NominatimPlace];
}

/**
 * Look up the regional key for a German place by name.
 *
 * `de:regionalschluessel` is tagged on the administrative boundary, so it is
 * present when the query resolves to a town or city but absent when it resolves
 * to a street, a house or a postcode — which is most real queries. One extra
 * search by city name recovers it.
 */
async function resolveArs(city: string): Promise<string | undefined> {
  const place = await shared(`ars:${city.toLowerCase()}`, async () => {
    try {
      const [first] = await nominatim('/search', { q: city, limit: '1', countrycodes: 'de' });
      return first ? toPlace(first) : null;
    } catch {
      // A missing regional key costs precision, not the lookup: leave it unset
      // and let the caller fall back. Cached as a miss so one failure is not
      // retried by every provider in the same fan-out.
      return null;
    }
  });
  return place?.ars;
}

/**
 * Resolve a lookup query to coordinates, or null when it names no place.
 *
 * Cached for LOCATION_GEOCODE_TTL, so the providers in one fan-out share a
 * single upstream request and a repeat lookup makes none.
 */
export async function geocode(query: string): Promise<GeoPlace | null> {
  const loc = normalizeLocation(query);
  return shared(`q:${loc.query.trim().toLowerCase()}`, async () => {
    let place: GeoPlace | null = null;
    try {
      const results =
        loc.isCoords && loc.lat !== undefined && loc.lon !== undefined
          ? await nominatim('/reverse', { lat: String(loc.lat), lon: String(loc.lon) })
          : await nominatim('/search', { q: loc.query, limit: '1' });
      place = results[0] ? toPlace(results[0]) : null;
    } catch {
      place = null;
    }

    if (place && !place.ars && place.country_code === 'de') {
      // `city` is absent for anything Nominatim files under another admin level —
      // a town like Greiz comes back with no city key at all — so fall back to
      // the first component of the display name, which is the place's own name.
      const name = place.city ?? place.display_name?.split(',')[0]?.trim();
      if (name) place.ars = await resolveArs(name);
    }
    return place;
  });
}
