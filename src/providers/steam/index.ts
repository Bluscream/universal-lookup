import { config } from '../../config.js';
import { filterAndSortProviders } from '../../lib/providers.js';
import type { LookupType, Provider, ProviderResult } from '../../types/common.js';
import { playerDbProvider } from './playerdb.js';
import { steamApiProvider } from './steam-api.js';
import { steamInventoryProvider } from './steam-inventory.js';
import { steamXmlProvider } from './steam-xml.js';
import { backpackTfProvider } from './backpack-tf.js';
import { csfloatProvider } from './csfloat.js';
import { steamDbProvider } from './steamdb.js';

/** All Steam lookup providers */
const ALL_STEAM_PROVIDERS: Provider[] = [
  playerDbProvider,
  steamXmlProvider,
  steamApiProvider,
  steamInventoryProvider,
  backpackTfProvider,
  csfloatProvider,
  steamDbProvider,
];

/**
 * Orchestrated Steam Lookup.
 * Resolves profile, queries official APIs, XML community feeds, inventory, external trading/DB services,
 * calculates SteamID formats locally, and appends external links.
 */
export async function lookupSteam(
  query: string,
  type?: LookupType,
  originalQuery?: string,
): Promise<ProviderResult[]> {
  const providers = filterAndSortProviders(ALL_STEAM_PROVIDERS, config.providersSteam);

  const initialProviders = providers.filter(
    (p) =>
      p.name !== 'steam-inventory' &&
      p.name !== 'backpack-tf' &&
      p.name !== 'csfloat' &&
      p.name !== 'steam-db',
  );
  
  const secondaryProviders = providers.filter(
    (p) =>
      p.name === 'steam-inventory' ||
      p.name === 'backpack-tf' ||
      p.name === 'csfloat' ||
      p.name === 'steam-db',
  );

  const start = Date.now();

  // 1. Run profile resolvers in parallel
  const results = await Promise.all(
    initialProviders.map((provider) =>
      Promise.race([
        provider.lookup(query, type, originalQuery),
        new Promise<ProviderResult>((_, reject) =>
          setTimeout(() => reject(new Error('Timeout')), config.providerTimeout),
        ),
      ]).catch(
        (error): ProviderResult => ({
          provider: provider.name,
          success: false,
          data: {},
          error: error instanceof Error ? error.message : String(error),
          duration: Date.now() - start,
        }),
      ),
    ),
  );

  // 2. Find a resolved SteamID64 (17 digits)
  let resolvedId64 = /^[0-9]{17}$/.test(query) ? query : '';
  if (!resolvedId64) {
    for (const r of results) {
      if (r.success && r.data?.steam_id_64) {
        resolvedId64 = r.data.steam_id_64 as string;
        break;
      }
    }
  }

  // 3. Run secondary lookups (inventory, backpack-tf, csfloat, steam-db) in parallel if ID64 is resolved
  if (resolvedId64 && secondaryProviders.length > 0) {
    const secondaryResults = await Promise.all(
      secondaryProviders.map((provider) =>
        Promise.race([
          provider.lookup(resolvedId64, type, originalQuery),
          new Promise<ProviderResult>((_, reject) =>
            setTimeout(() => reject(new Error('Timeout')), config.providerTimeout),
          ),
        ]).catch(
          (error): ProviderResult => ({
            provider: provider.name,
            success: false,
            data: {},
            error: error instanceof Error ? error.message : String(error),
            duration: Date.now() - start,
          }),
        ),
      ),
    );
    results.push(...secondaryResults);
  }

  // 4. Generate direct external reference links & local math-calculated SteamIDs
  if (resolvedId64) {
    // Local mathematical calculations for SteamID2 and SteamID3
    let steamId2 = 'Unknown';
    let steamId3 = 'Unknown';
    try {
      const steam64 = BigInt(resolvedId64);
      const baseId = 76561197960265728n;
      if (steam64 >= baseId) {
        const accountId = steam64 - baseId;
        const y = accountId % 2n;
        const z = (accountId - y) / 2n;
        steamId2 = `STEAM_0:${y}:${z}`;
        steamId3 = `[U:1:${accountId}]`;
      }
    } catch {
      // Ignored
    }

    results.push({
      provider: 'steam-links',
      success: true,
      data: {
        steam_id_2: steamId2,
        steam_id_3: steamId3,
        steam_links: {
          steam_community: `https://steamcommunity.com/profiles/${resolvedId64}`,
          steam_db: `https://steamdb.info/calculator/${resolvedId64}/`,
          steam_rep: `https://steamrep.com/profiles/${resolvedId64}`,
          backpack_tf: `https://backpack.tf/profiles/${resolvedId64}`,
          csfloat: `https://csfloat.com/db?user=${resolvedId64}`,
          steamid_finder: `https://steamidfinder.com/lookup/${resolvedId64}`,
          steamhistory: `https://steamhistory.net/profiles/${resolvedId64}`,
          bansearch: `https://bansearch.com/profiles/${resolvedId64}`,
          vaclist: `https://vaclist.net/profiles/${resolvedId64}`,
        },
      },
      duration: 0,
    });
  }

  return results;
}
