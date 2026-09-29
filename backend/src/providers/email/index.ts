import { config } from '../../config.js';
import {
  type DualPromiseResult,
  executeProvidersBackground,
  filterAndSortProviders,
} from '../../lib/providers.js';
import type { LookupType, Provider } from '../../types/common.js';
import { bingProvider, duckduckgoProvider, googleProvider, yahooProvider } from '../web/index.js';
import { dnsEmail } from './dns-email.js';
import { ipApiIoAdvEmail } from './ip-api-io-adv.js';
import { ipApiIoEmail } from './ip-api-io-email.js';
import { ipApiIoEmailRisk } from './ip-api-io-risk.js';

const ALL_PROVIDERS: Provider[] = [
  dnsEmail,
  ipApiIoEmail,
  ipApiIoAdvEmail,
  ipApiIoEmailRisk,
  googleProvider,
  bingProvider,
  duckduckgoProvider,
  yahooProvider,
];

export function lookupEmail(query: string, type?: LookupType): DualPromiseResult {
  const providers = filterAndSortProviders(ALL_PROVIDERS, config.providersEmail);

  return executeProvidersBackground(providers, query, type);
}

/** Every provider registered for this lookup type, in registry order. */
export const PROVIDERS = ALL_PROVIDERS;

/** Names of every provider registered for this lookup type. */
export const PROVIDER_NAMES: string[] = PROVIDERS.map((p) => p.name);
