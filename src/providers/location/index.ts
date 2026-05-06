import { config } from '../../config.js';
import type { Provider, ProviderResult } from '../../types/common.js';
import { googleMaps } from './google-maps.js';
import { nominatim } from './nominatim.js';

const ALL_PROVIDERS: Provider[] = [nominatim, googleMaps];

export async function lookupLocation(query: string): Promise<ProviderResult[]> {
  const providers = ALL_PROVIDERS.filter((p) => p.isAvailable());
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
