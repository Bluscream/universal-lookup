import {
  type DualPromiseResult,
  executeProvidersBackground,
  filterProviders,
} from '../../lib/providers.js';
import type { LookupType, Provider } from '../../types/common.js';
import { dnsEmail } from './dns-email.js';
import { ipApiIoAdvEmail } from './ip-api-io-adv.js';
import { ipApiIoEmail } from './ip-api-io-email.js';
import { ipApiIoEmailRisk } from './ip-api-io-risk.js';

const ALL_PROVIDERS: Provider[] = [dnsEmail, ipApiIoEmail, ipApiIoAdvEmail, ipApiIoEmailRisk];

export function lookupEmail(query: string, type?: LookupType): DualPromiseResult {
  const providers = filterProviders(ALL_PROVIDERS, 'email');

  return executeProvidersBackground(providers, query, type);
}

/** Every provider registered for this lookup type, in registry order. */
export const PROVIDERS = ALL_PROVIDERS;

/** Names of every provider registered for this lookup type. */
export const PROVIDER_NAMES: string[] = PROVIDERS.map((p) => p.name);
