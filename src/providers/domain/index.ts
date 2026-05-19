import { config } from '../../config.js';
import { filterAndSortProviders } from '../../lib/providers.js';
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
export async function lookupDomain(
  query: string,
  type?: LookupType,
  originalQuery?: string,
): Promise<ProviderResult[]> {
  const providers = filterAndSortProviders(ALL_PROVIDERS, config.providersDomain);

  const results = await Promise.allSettled(
    providers.map((provider) =>
      Promise.race([
        provider.lookup(query, type, originalQuery),
        new Promise<ProviderResult>((_, reject) =>
          setTimeout(() => reject(new Error('Timeout')), config.providerTimeout),
        ),
      ]).catch(
        (error): ProviderResult => ({
          provider: provider.name,
          success: false,
          data: {},
          error: error instanceof Error ? error.message : String(error),
          duration: config.providerTimeout,
        }),
      ),
    ),
  );

  return results.map((r) =>
    r.status === 'fulfilled'
      ? r.value
      : {
          provider: 'unknown',
          success: false,
          data: {},
          error: 'Promise rejected',
          duration: 0,
        },
  );
}
