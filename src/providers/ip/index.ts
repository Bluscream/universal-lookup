import { config } from '../../config.js';
import { executeProvidersBackground, filterAndSortProviders, type DualPromiseResult } from '../../lib/providers.js';
import type { LookupType, Provider, ProviderResult } from '../../types/common.js';
import { dnsProvider } from '../domain/dns.js';
import { subdomainProvider } from '../domain/subdomain.js';
import { whois } from '../domain/whois.js';
import { bingProvider, duckduckgoProvider, googleProvider, yahooProvider } from '../web/index.js';
import { ipApiCom } from './ip-api-com.js';
import { ipApiIo } from './ip-api-io.js';
import { ipApiIoRisk } from './ip-api-io-risk.js';
import { maxmind } from './maxmind.js';
import { pingProvider } from './ping.js';
import { portscanProvider } from './portscan.js';
import { tracerouteProvider } from './traceroute.js';

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
export function lookupIp(
  query: string,
  type?: LookupType, originalQuery?: string,
): DualPromiseResult {
  const providers = filterAndSortProviders(ALL_PROVIDERS, config.providersIp);

  return executeProvidersBackground(providers, query, type, originalQuery);
}
