import { config } from '../../config.js';
import type { Provider, ProviderResult } from '../../types/common.js';
import { filterAndSortProviders } from '../../lib/providers.js';
import { googleMaps } from './google-maps.js';
import { nominatim } from './nominatim.js';

import { googleProvider, bingProvider, duckduckgoProvider, yahooProvider } from '../web/index.js';

const ALL_PROVIDERS: Provider[] = [
  nominatim,
  googleMaps,
  googleProvider,
  bingProvider,
  duckduckgoProvider,
  yahooProvider,
];

export async function lookupLocation(query: string): Promise<ProviderResult[]> {
  const providers = filterAndSortProviders(ALL_PROVIDERS, config.providersLocation);
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
      : { provider: 'unknown', success: false, data: {}, error: 'Promise rejected', duration: 0 },
  );
}
