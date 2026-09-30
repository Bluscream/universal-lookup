import {
  type DualPromiseResult,
  executeProvidersBackground,
  filterProviders,
} from '../../lib/providers.js';
import type { LookupType, Provider } from '../../types/common.js';
import { dnsProvider } from './dns.js';
import { subdomainProvider } from './subdomain.js';
import { whois } from './whois.js';

/** All domain lookup providers in priority order */
const ALL_PROVIDERS: Provider[] = [whois, dnsProvider, subdomainProvider];

/**
 * Run all available Domain providers in parallel with timeout.
 */
export function lookupDomain(
  query: string,
  type?: LookupType,
  originalQuery?: string,
): DualPromiseResult {
  const providers = filterProviders(ALL_PROVIDERS, 'domain');

  return executeProvidersBackground(providers, query, type, originalQuery);
}

/** Every provider registered for this lookup type, in registry order. */
export const PROVIDERS = ALL_PROVIDERS;

/** Names of every provider registered for this lookup type. */
export const PROVIDER_NAMES: string[] = PROVIDERS.map((p) => p.name);
