import { config } from '../../config.js';
import type { Provider, ProviderResult } from '../../types/common.js';
import { dhl } from './dhl.js';
import { dhlWeb } from './dhl-web.js';
import { parcelsapp } from './parcelsapp.js';

const ALL_PROVIDERS: Provider[] = [dhlWeb, dhl, parcelsapp];

export async function lookupParcel(query: string): Promise<ProviderResult[]> {
  const providers = ALL_PROVIDERS.filter((p) => p.isAvailable());
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
        provider.lookup(query),
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
