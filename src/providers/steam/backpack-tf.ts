import axios from 'axios';
import { config } from '../../config.js';
import type { LookupType, Provider, ProviderResult } from '../../types/common.js';

const PROVIDER_NAME = 'backpack-tf';

/**
 * backpack-tf — External Steam reputation & trading metrics.
 * Queries Backpack.tf JSON API (which is Turnstile-free if a key is provided) to fetch:
 * - positive/negative trust ratings
 * - TF2 inventory value
 * - premium status / bans
 */
export const backpackTfProvider: Provider = {
  name: PROVIDER_NAME,

  isAvailable() {
    return !!config.backpackTfApiKey;
  },

  async lookup(query: string, _type?: LookupType): Promise<ProviderResult> {
    const start = Date.now();
    const key = config.backpackTfApiKey;

    if (!key) {
      return {
        provider: PROVIDER_NAME,
        success: false,
        data: {},
        error: 'Backpack.tf API key is not configured',
        duration: Date.now() - start,
      };
    }

    try {
      // Clean query of any spaces
      const steamId = query.trim();
      const url = `https://backpack.tf/api/users/info/v1?steamids=${steamId}&key=${key}`;
      
      const res = await axios.get(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
        timeout: config.providerTimeout,
      });

      const player = res.data?.response?.players?.[steamId];
      if (!player) {
        return {
          provider: PROVIDER_NAME,
          success: false,
          data: {},
          raw: res.data,
          error: 'No player data found in backpack.tf response',
          duration: Date.now() - start,
        };
      }

      // Extract values
      const tf2Value = player.backpack_value?.['440'] || 0;
      const trustFor = player.backpack_tf_trust?.for || 0;
      const trustAgainst = player.backpack_tf_trust?.against || 0;
      const isBanned = !!player.backpack_tf_banned || !!player.ban_reputation;
      const isPremium = !!player.backpack_tf_premium;

      return {
        provider: PROVIDER_NAME,
        success: true,
        data: {
          backpack_value_tf2: tf2Value,
          trust_positive: trustFor,
          trust_negative: trustAgainst,
          backpack_tf_banned: isBanned,
          backpack_tf_premium: isPremium,
        },
        raw: player,
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
