import { config } from '../../config.js';
import { filterAndSortProviders } from '../../lib/providers.js';
import type { LookupType, Provider, ProviderResult } from '../../types/common.js';
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

export async function lookupEmail(query: string, type?: LookupType): Promise<ProviderResult[]> {
  const providers = filterAndSortProviders(ALL_PROVIDERS, config.providersEmail);
  const results = await Promise.allSettled(
    providers.map((provider) =>
      Promise.race([
        provider.lookup(query, type),
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
      : { provider: 'unknown', success: false, data: {}, error: 'Promise rejected', duration: 0 },
  );
}
