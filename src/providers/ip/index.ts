import type { Provider, ProviderResult } from '../../types/common.js';
import { config } from '../../config.js';
import { ipApiCom } from './ip-api-com.js';
import { ipApiIo } from './ip-api-io.js';
import { ipApiIoRisk } from './ip-api-io-risk.js';
import { maxmind } from './maxmind.js';
import { whois } from './whois.js';
import { dnsProvider } from './dns.js';
import { pingProvider } from './ping.js';
import { tracerouteProvider } from './traceroute.js';
import { portscanProvider } from './portscan.js';
import { subdomainProvider } from './subdomain.js';

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
];

/**
 * Run all available IP providers in parallel with timeout.
 */
export async function lookupIp(query: string): Promise<ProviderResult[]> {
  const providers = ALL_PROVIDERS.filter(p => p.isAvailable());

  const results = await Promise.allSettled(
    providers.map(provider =>
      Promise.race([
        provider.lookup(query),
        new Promise<ProviderResult>((_, reject) =>
          setTimeout(() => reject(new Error('Timeout')), config.providerTimeout)
        ),
      ]).catch((error): ProviderResult => ({
        provider: provider.name,
        success: false,
        data: {},
        error: error instanceof Error ? error.message : String(error),
        duration: config.providerTimeout,
      }))
    )
  );

  return results.map(r => r.status === 'fulfilled' ? r.value : {
    provider: 'unknown',
    success: false,
    data: {},
    error: 'Promise rejected',
    duration: 0,
  });
}
