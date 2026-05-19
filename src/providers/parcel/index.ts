import { config } from '../../config.js';
import { filterAndSortProviders } from '../../lib/providers.js';
import type { LookupType, Provider, ProviderResult } from '../../types/common.js';
import { bingProvider, duckduckgoProvider, googleProvider, yahooProvider } from '../web/index.js';
import { dhl } from './dhl.js';
import { dhlWeb } from './dhl-web.js';
import { parcelsapp } from './parcelsapp.js';
import { pkge } from './pkge.js';

const ALL_PROVIDERS: Provider[] = [
  dhlWeb,
  dhl,
  parcelsapp,
  pkge,
  googleProvider,
  bingProvider,
  duckduckgoProvider,
  yahooProvider,
];

export async function lookupParcel(query: string, type?: LookupType): Promise<ProviderResult[]> {
  const providers = filterAndSortProviders(ALL_PROVIDERS, config.providersParcel);
  if (providers.length === 0) {
    return [
      {
        provider: 'parcel',
        success: false,
        data: {},
        error: 'No parcel tracking providers available',
        duration: 0,
      },
    ];
  }
  const results = await Promise.allSettled(
    providers.map((provider) =>
      Promise.race([
        provider.lookup(query, type),
        new Promise<ProviderResult>(
          (_, reject) =>
            setTimeout(() => reject(new Error('Timeout')), config.providerTimeout + 15000), // Extra time for polling
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
