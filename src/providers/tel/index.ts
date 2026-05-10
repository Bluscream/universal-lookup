import { config } from '../../config.js';
import { filterAndSortProviders } from '../../lib/providers.js';
import type { LookupType, Provider, ProviderResult } from '../../types/common.js';
import { bingProvider, duckduckgoProvider, googleProvider, yahooProvider } from '../web/index.js';
import { provider11880 } from './11880.js';
import { dasoertliche } from './dasoertliche.js';
import { dastelefonbuch } from './dastelefonbuch.js';
import { emergencyProvider } from './emergency.js';
import { fritzbox } from './fritzbox.js';
import { tellows } from './tellows.js';

const ALL_PROVIDERS: Provider[] = [
  emergencyProvider,
  fritzbox,
  tellows,
  dastelefonbuch,
  provider11880,
  dasoertliche,
  googleProvider,
  bingProvider,
  duckduckgoProvider,
  yahooProvider,
];

export async function lookupTel(query: string, type?: LookupType): Promise<ProviderResult[]> {
  const providers = filterAndSortProviders(ALL_PROVIDERS, config.providersTel);

  const results = await Promise.allSettled(
    providers.map((provider) =>
      Promise.race([
        provider.lookup(query, type),
        new Promise<ProviderResult>((_, reject) =>
          setTimeout(
            () => reject(new Error(`${provider.name} provider timed out`)),
            config.providerTimeout + 2000,
          ),
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
      : {
          provider: 'unknown',
          success: false,
          data: {},
          error: 'Promise rejected',
          duration: 0,
        },
  );
}
