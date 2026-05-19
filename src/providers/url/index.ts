import { config } from '../../config.js';
import { filterAndSortProviders } from '../../lib/providers.js';
import type { LookupType, Provider, ProviderResult } from '../../types/common.js';
import { dnsLookupProvider } from './dns-lookup.js';
import { ipInfoProvider } from './ip-info.js';
import { metadataProvider } from './metadata.js';
import { urlscanProvider } from './urlscan.js';
import { virustotalProvider } from './virustotal.js';

/** All URL lookup providers */
const ALL_URL_PROVIDERS: Provider[] = [
  dnsLookupProvider,
  metadataProvider,
  urlscanProvider,
  virustotalProvider,
  ipInfoProvider,
];

/**
 * Orchestrated URL Lookup.
 * Resolves DNS, scrapes HTML metadata/SSL certs, runs API scans, extracts server IPs,
 * and launches IP geolocation/threat engines on the target host.
 */
export async function lookupUrl(
  query: string,
  type?: LookupType,
  originalQuery?: string,
): Promise<ProviderResult[]> {
  const providers = filterAndSortProviders(ALL_URL_PROVIDERS, config.providersUrl);

  const initialProviders = providers.filter((p) => p.name !== 'ip-info');
  const ipProvider = providers.find((p) => p.name === 'ip-info');

  const start = Date.now();

  // 1. Run DNS, Scraper, and Scanner APIs in parallel
  const results = await Promise.all(
    initialProviders.map((provider) =>
      Promise.race([
        provider.lookup(query, type, originalQuery),
        new Promise<ProviderResult>((_, reject) =>
          setTimeout(() => reject(new Error('Timeout')), config.providerTimeout + 2000),
        ),
      ]).catch(
        (error): ProviderResult => ({
          provider: provider.name,
          success: false,
          data: {},
          error: error instanceof Error ? error.message : String(error),
          duration: Date.now() - start,
        }),
      ),
    ),
  );

  // 2. Extract resolved IP address from DNS lookup results
  let resolvedIp = '';
  const dnsRes = results.find((r) => r.provider === 'dns-lookup' && r.success);
  if (dnsRes) {
    const aRecords = dnsRes.data?.dns_a as string[];
    const aaaaRecords = dnsRes.data?.dns_aaaa as string[];
    resolvedIp = aRecords?.[0] || aaaaRecords?.[0] || '';
  }

  // 3. Trigger IP info lookup (geo, hosting, AS, port scan) if IP was resolved
  if (resolvedIp && ipProvider) {
    try {
      const ipRes = await Promise.race([
        ipProvider.lookup(resolvedIp, type, originalQuery),
        new Promise<ProviderResult>((_, reject) =>
          setTimeout(() => reject(new Error('Timeout')), config.providerTimeout),
        ),
      ]);
      results.push(ipRes);
    } catch (error) {
      results.push({
        provider: ipProvider.name,
        success: false,
        data: {},
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - start,
      });
    }
  }

  return results;
}
