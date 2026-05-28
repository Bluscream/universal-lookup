import axios from 'axios';
import { config } from '../../config.js';
import type { LookupType, Provider, ProviderResult, SteamData } from '../../types/common.js';

const PROVIDER_NAME = 'playerdb';

/**
 * playerdb.co — Free gaming platform accounts lookup API.
 * Docs: https://playerdb.co/
 */
export const playerDbProvider: Provider = {
  name: PROVIDER_NAME,

  isAvailable() {
    return true; // Free public API
  },

  async lookup(query: string, _type?: LookupType): Promise<ProviderResult<SteamData>> {
    const start = Date.now();

    try {
      const url = `https://playerdb.co/api/player/steam/${encodeURIComponent(query)}`;
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Universal-Lookup/1.0 (https://github.com/Bluscream/universal-lookup)',
        },
        timeout: config.serverTimeout,
      });

      const raw = response.data;

      if (!raw.success || raw.code !== 'player.found' || !raw.data?.player) {
        return {
          provider: PROVIDER_NAME,
          success: false,
          data: {},
          raw,
          error: raw.message || 'Player not found',
          duration: Date.now() - start,
        };
      }

      const player = raw.data.player;
      const meta = player.meta || {};

      const data: SteamData = {
        steam_id_64: player.id || meta.steamid,
        username: player.username || meta.personaname,
        avatar_url: player.avatar || meta.avatarfull,
        profile_url: meta.profileurl || `https://steamcommunity.com/profiles/${player.id}`,
        real_name: meta.realname || null,
        country_code: meta.loccountrycode || null,
        created_at: meta.timecreated ? new Date(meta.timecreated * 1000).toISOString() : null,
      };

      return {
        provider: PROVIDER_NAME,
        success: true,
        data,
        raw,
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
