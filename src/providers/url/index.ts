import { config } from '../../config.js';
import { executeProvidersBackground, filterAndSortProviders, type DualPromiseResult } from '../../lib/providers.js';
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
export function lookupUrl(
  query: string,
  type?: LookupType, originalQuery?: string,
): DualPromiseResult {
  const providers = filterAndSortProviders(ALL_URL_PROVIDERS, config.providersUrl);

  return executeProvidersBackground(providers, query, type, originalQuery);
}
