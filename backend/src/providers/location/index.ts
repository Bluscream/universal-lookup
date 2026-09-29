import { config } from '../../config.js';
import {
  type DualPromiseResult,
  executeProvidersBackground,
  filterAndSortProviders,
} from '../../lib/providers.js';
import type { LookupType, Provider } from '../../types/common.js';
import { bingProvider, duckduckgoProvider, googleProvider, yahooProvider } from '../web/index.js';
import { googleMaps } from './google-maps.js';
import { nominatim } from './nominatim.js';

const ALL_PROVIDERS: Provider[] = [
  nominatim,
  googleMaps,
  googleProvider,
  bingProvider,
  duckduckgoProvider,
  yahooProvider,
];

export function lookupLocation(query: string, type?: LookupType): DualPromiseResult {
  const providers = filterAndSortProviders(ALL_PROVIDERS, config.providersLocation);

  return executeProvidersBackground(providers, query, type);
}

/** Names of every provider registered for this lookup type. */
export const PROVIDER_NAMES: string[] = ALL_PROVIDERS.map((p) => p.name);
