import { config } from '../../config.js';
import type { Provider, ProviderResult } from '../../types/common.js';
import { filterAndSortProviders } from '../../lib/providers.js';
import { dnsProvider } from '../ip/dns.js';
import { whois } from '../ip/whois.js';
import { subdomainProvider } from '../ip/subdomain.js';
import { googleProvider, bingProvider, duckduckgoProvider, yahooProvider } from '../web/index.js';

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
export async function lookupDomain(query: string): Promise<ProviderResult[]> {
  const providers = filterAndSortProviders(ALL_PROVIDERS, config.providersDomain);

  const results = await Promise.allSettled(
    providers.map((provider) =>
      Promise.race([
        provider.lookup(query),
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
