import {
  type DualPromiseResult,
  executeProvidersBackground,
  filterProviders,
} from '../../lib/providers.js';
import type { LookupType, Provider } from '../../types/common.js';
import { googleMaps } from './google-maps.js';
import { nominatim } from './nominatim.js';

const ALL_PROVIDERS: Provider[] = [nominatim, googleMaps];

export function lookupLocation(query: string, type?: LookupType): DualPromiseResult {
  const providers = filterProviders(ALL_PROVIDERS, 'location');

  return executeProvidersBackground(providers, query, type);
}

/** Every provider registered for this lookup type, in registry order. */
export const PROVIDERS = ALL_PROVIDERS;

/** Names of every provider registered for this lookup type. */
export const PROVIDER_NAMES: string[] = PROVIDERS.map((p) => p.name);
