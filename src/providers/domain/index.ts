import { config } from '../../config.js';
import { executeProvidersBackground, filterAndSortProviders, type DualPromiseResult } from '../../lib/providers.js';
import type { LookupType, Provider, ProviderResult } from '../../types/common.js';
import { bingProvider, duckduckgoProvider, googleProvider, yahooProvider } from '../web/index.js';
import { dnsProvider } from './dns.js';
import { subdomainProvider } from './subdomain.js';
import { whois } from './whois.js';

/** All domain lookup providers in priority order */
const ALL_PROVIDERS: Provider[] = [
  whois,
  dnsProvider,
  subdomainProvider,
  googleProvider,
  bingProvider,
  duckduckgoProvider,
  yahooProvider,
];

/**
 * Run all available Domain providers in parallel with timeout.
 */
export function lookupDomain(
  query: string,
  type?: LookupType, originalQuery?: string,
): DualPromiseResult {
  const providers = filterAndSortProviders(ALL_PROVIDERS, config.providersDomain);

  return executeProvidersBackground(providers, query, type, originalQuery);
}
