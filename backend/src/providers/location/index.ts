import {
  type DualPromiseResult,
  executeProvidersBackground,
  filterProviders,
} from '../../lib/providers.js';
import type { LookupType, Provider } from '../../types/common.js';
import { dwdWarnings } from './dwd.js';
import { googleMaps } from './google-maps.js';
import { ninaWarnings } from './nina.js';
import { nominatim } from './nominatim.js';
import { openMeteo } from './open-meteo.js';

/**
 * Geocoders first, then the providers that describe what is happening at the
 * place. The latter geocode through the shared cache in geo.ts rather than
 * reading the geocoders' results, since the fan-out is parallel.
 */
const ALL_PROVIDERS: Provider[] = [nominatim, googleMaps, dwdWarnings, ninaWarnings, openMeteo];

export function lookupLocation(query: string, type?: LookupType): DualPromiseResult {
  const providers = filterProviders(ALL_PROVIDERS, 'location');

  return executeProvidersBackground(providers, query, type);
}

/** Every provider registered for this lookup type, in registry order. */
export const PROVIDERS = ALL_PROVIDERS;

/** Names of every provider registered for this lookup type. */
export const PROVIDER_NAMES: string[] = PROVIDERS.map((p) => p.name);
