import { config } from '../../config.js';
import {
  type DualPromiseResult,
  executeProvidersBackground,
  filterAndSortProviders,
} from '../../lib/providers.js';
import type { LookupType, Provider } from '../../types/common.js';
import { amazon } from './amazon.js';

const ALL_PROVIDERS: Provider[] = [
  amazon,
];

export function lookupOrder(query: string, type?: LookupType): DualPromiseResult {
  const providers = filterAndSortProviders(ALL_PROVIDERS, config.providersOrder);

  return executeProvidersBackground(providers, query, type);
}
