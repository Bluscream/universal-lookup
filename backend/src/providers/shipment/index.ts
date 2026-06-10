import { config } from '../../config.js';
import {
  type DualPromiseResult,
  executeProvidersBackground,
  filterAndSortProviders,
} from '../../lib/providers.js';
import type { LookupType, Provider } from '../../types/common.js';
import { bingProvider, duckduckgoProvider, googleProvider, yahooProvider } from '../web/index.js';
import { amazon } from './amazon.js';

const ALL_PROVIDERS: Provider[] = [
  amazon,
  googleProvider,
  bingProvider,
  duckduckgoProvider,
  yahooProvider,
];

export function lookupShipment(query: string, type?: LookupType): DualPromiseResult {
  const providers = filterAndSortProviders(ALL_PROVIDERS, config.providersShipment);

  return executeProvidersBackground(providers, query, type);
}
