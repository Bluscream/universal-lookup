import { config } from '../../config.js';
import {
  type DualPromiseResult,
  executeProvidersBackground,
  filterAndSortProviders,
} from '../../lib/providers.js';
import type { LookupType, Provider } from '../../types/common.js';
import { dnsLookupProvider } from './dns-lookup.js';
import { ipInfoProvider } from './ip-info.js';
import { metadataProvider } from './metadata.js';
import { semontoProvider } from './semonto.js';
import { urlscanProvider } from './urlscan.js';
import { virustotalProvider } from './virustotal.js';

/** All URL lookup providers */
const ALL_URL_PROVIDERS: Provider[] = [
  dnsLookupProvider,
  metadataProvider,
  semontoProvider,
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
  type?: LookupType,
  originalQuery?: string,
): DualPromiseResult {
  const providers = filterAndSortProviders(ALL_URL_PROVIDERS, config.providersUrl);

  return executeProvidersBackground(providers, query, type, originalQuery);
}
