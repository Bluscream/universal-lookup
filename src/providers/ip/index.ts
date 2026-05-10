import { config } from '../../config.js';
import type { Provider, ProviderResult } from '../../types/common.js';
import { filterAndSortProviders } from '../../lib/providers.js';
import { dnsProvider } from '../domain/dns.js';
import { ipApiCom } from './ip-api-com.js';
import { ipApiIo } from './ip-api-io.js';
import { ipApiIoRisk } from './ip-api-io-risk.js';
import { maxmind } from './maxmind.js';
import { pingProvider } from './ping.js';
import { portscanProvider } from './portscan.js';
import { subdomainProvider } from '../domain/subdomain.js';
import { tracerouteProvider } from './traceroute.js';
import { whois } from '../domain/whois.js';

import { googleProvider, bingProvider, duckduckgoProvider, yahooProvider } from '../web/index.js';

/** All IP lookup providers in priority order */
const ALL_PROVIDERS: Provider[] = [
  ipApiCom,
  ipApiIo,
  ipApiIoRisk,
  maxmind,
  whois,
  dnsProvider,
  pingProvider,
  tracerouteProvider,
  portscanProvider,
  subdomainProvider,
  googleProvider,
  bingProvider,
  duckduckgoProvider,
  yahooProvider,
];

/**
 * Run all available IP providers in parallel with timeout.
 */
export async function lookupIp(query: string): Promise<ProviderResult[]> {
  const providers = filterAndSortProviders(ALL_PROVIDERS, config.providersIp);

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
