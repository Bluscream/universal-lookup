import axios from 'axios';
import { config } from '../../config.js';
import type { LookupType, Provider, ProviderResult } from '../../types/common.js';

const PROVIDER_NAME = 'steam-inventory';

interface GameConfig {
  name: string;
  appId: number;
}

const POPULAR_GAMES: GameConfig[] = [
  { name: 'Team Fortress 2', appId: 440 },
  { name: 'Counter-Strike 2', appId: 730 },
  { name: 'Dota 2', appId: 570 },
  { name: 'Rust', appId: 252490 },
];

/**
 * steam-inventory — Fetches inventories of popular Steam games to count items and check privacy.
 */
export const steamInventoryProvider: Provider = {
  name: PROVIDER_NAME,

  isAvailable() {
    return true; // Uses public community endpoints
  },

  async lookup(query: string, _type?: LookupType): Promise<ProviderResult> {
    const start = Date.now();

    // Inventory query requires SteamID64 (17 digits)
    if (!/^[0-9]{17}$/.test(query)) {
      return {
        provider: PROVIDER_NAME,
        success: false,
        data: {},
        error: 'Inventory check requires a fully resolved 17-digit SteamID64',
        duration: Date.now() - start,
      };
    }

    try {
      const results = await Promise.allSettled(
        POPULAR_GAMES.map(async (game) => {
          const url = `https://steamcommunity.com/inventory/${query}/${game.appId}/2?l=english&count=10`;
          try {
            const resp = await axios.get(url, {
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
              },
              timeout: Math.min(5000, config.providerTimeout), // Fail fast for single game inventories
            });

            const data = resp.data;
            if (data?.success) {
              const itemCount = data.total_inventory_count ?? 0;
              const sampleItems = data.descriptions
                ? data.descriptions
                    .slice(0, 5)
                    .map((d: { market_name?: string; name?: string }) => d.market_name || d.name)
                    .filter(Boolean)
                : [];

              return {
                game: game.name,
                app_id: game.appId,
                status: 'Public',
                item_count: itemCount,
                sample_items: sampleItems,
              };
            }
            return {
              game: game.name,
              app_id: game.appId,
              status: 'Private or Empty',
              item_count: 0,
              sample_items: [],
            };
          } catch (err) {
            const status =
              axios.isAxiosError(err) &&
              (err.response?.status === 403 || err.response?.status === 401)
                ? 'Private'
                : 'Not Owned or Error';
            return {
              game: game.name,
              app_id: game.appId,
              status,
              item_count: 0,
              sample_items: [],
            };
          }
        }),
      );

      const inventories: Record<string, unknown>[] = [];
      let totalItems = 0;
      let hasPublic = false;

      for (const res of results) {
        if (res.status === 'fulfilled') {
          inventories.push(res.value);
          totalItems += res.value.item_count;
          if (res.value.status === 'Public') {
            hasPublic = true;
          }
        }
      }

      return {
        provider: PROVIDER_NAME,
        success: true,
        data: {
          inventories,
          total_inventory_items: totalItems,
          has_public_inventories: hasPublic,
        },
        raw: inventories,
        duration: Date.now() - start,
      };
    } catch (error) {
      return {
        provider: PROVIDER_NAME,
        success: false,
        data: {},
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - start,
      };
    }
  },
};
