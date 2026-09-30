import {
  type DualPromiseResult,
  executeProvidersBackground,
  filterProviders,
} from '../../lib/providers.js';
import type { LookupType, Provider } from '../../types/common.js';
import { aliexpress } from './aliexpress.js';
import { amazon } from './amazon.js';

const ALL_PROVIDERS: Provider[] = [amazon, aliexpress];

export function lookupOrder(
  query: string,
  type?: LookupType,
  originalQuery?: string,
  options?: { postalCode?: string },
): DualPromiseResult {
  const providers = filterProviders(ALL_PROVIDERS, 'order');

  return executeProvidersBackground(providers, query, type, originalQuery, options);
}

/** Every provider registered for this lookup type, in registry order. */
export const PROVIDERS = ALL_PROVIDERS;

/** Names of every provider registered for this lookup type. */
export const PROVIDER_NAMES: string[] = PROVIDERS.map((p) => p.name);
