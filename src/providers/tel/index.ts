import { config } from '../../config.js';
import type { Provider, ProviderResult } from '../../types/common.js';
import { provider11880 } from './11880.js';
import { dasoertliche } from './dasoertliche.js';
import { dastelefonbuch } from './dastelefonbuch.js';
import { fritzbox } from './fritzbox.js';
import { tellows } from './tellows.js';

const ALL_PROVIDERS: Provider[] = [fritzbox, tellows, dastelefonbuch, provider11880, dasoertliche];

export async function lookupTel(query: string): Promise<ProviderResult[]> {
  const providers = ALL_PROVIDERS.filter((p) => p.isAvailable());

  const results = await Promise.allSettled(
    providers.map((provider) =>
      Promise.race([
        provider.lookup(query),
        new Promise<ProviderResult>((_, reject) =>
          setTimeout(() => reject(new Error(`${provider.name} provider timed out`)), config.providerTimeout + 2000),
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
