import axios from 'axios';
import { config } from '../../config.js';
import type { LookupType, Provider, ProviderResult } from '../../types/common.js';

const PROVIDER_NAME = 'steam-api';

interface SteamOwnedGame {
  appid: number;
  name?: string;
  playtime_forever?: number;
}

/**
 * steam-api — Official Steam Web API.
 * Uses official API methods: ResolveVanityURL, GetPlayerSummaries, GetPlayerBans.
 */
export const steamApiProvider: Provider = {
  name: PROVIDER_NAME,

  isAvailable() {
    return !!config.steamApiKey;
  },

  async lookup(query: string, _type?: LookupType): Promise<ProviderResult> {
    const start = Date.now();
    const key = config.steamApiKey;

    try {
      let steamId64 = query;

      // 1. Resolve vanity URL if it's not a SteamID64 (digits of length 17)
      if (!/^[0-9]{17}$/.test(steamId64)) {
        const resolveUrl = `https://api.steampowered.com/ISteamUser/ResolveVanityURL/v0001/?key=${key}&vanityurl=${encodeURIComponent(steamId64)}`;
        const resolveResp = await axios.get(resolveUrl, { timeout: config.serverTimeout });
        const resolveData = resolveResp.data.response;

        if (resolveData?.success === 1 && resolveData.steamid) {
          steamId64 = resolveData.steamid;
        } else {
          return {
            provider: PROVIDER_NAME,
            success: false,
            data: {},
            raw: resolveData,
            error: 'Failed to resolve Steam vanity URL',
            duration: Date.now() - start,
          };
        }
      }

      // 2. Query GetPlayerSummaries, GetPlayerBans, and GetOwnedGames in parallel
      const summariesUrl = `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?key=${key}&steamids=${steamId64}`;
      const bansUrl = `https://api.steampowered.com/ISteamUser/GetPlayerBans/v1/?key=${key}&steamids=${steamId64}`;
      const ownedGamesUrl = `https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${key}&steamid=${steamId64}&include_appinfo=true&include_played_free_games=true`;

      const [summariesResp, bansResp, ownedGamesResp] = await Promise.all([
        axios.get(summariesUrl, { timeout: config.serverTimeout }).catch(() => null),
        axios.get(bansUrl, { timeout: config.serverTimeout }).catch(() => null),
        axios.get(ownedGamesUrl, { timeout: config.serverTimeout }).catch(() => null),
      ]);

      const summaryRaw = summariesResp?.data?.response?.players?.[0];
      const bansRaw = bansResp?.data?.players?.[0];
      const ownedGamesRaw = ownedGamesResp?.data?.response;

      if (!summaryRaw) {
        return {
          provider: PROVIDER_NAME,
          success: false,
          data: {},
          error: 'Failed to retrieve player summary',
          duration: Date.now() - start,
        };
      }

      // Map details
      const data: Record<string, unknown> = {
        steam_id_64: steamId64,
        username: summaryRaw.personaname,
        profile_url: summaryRaw.profileurl,
        avatar_url: summaryRaw.avatarfull || summaryRaw.avatar,
        persona_state: summaryRaw.personastate, // 0: Offline, 1: Online, 2: Busy, 3: Away, 4: Snooze, 5: Looking to Trade, 6: Looking to Play
        community_visibility_state: summaryRaw.communityvisibilitystate, // 1: Private, 3: Public
        last_logoff: summaryRaw.lastlogoff
          ? new Date(summaryRaw.lastlogoff * 1000).toISOString()
          : null,
        real_name: summaryRaw.realname || null,
        primary_clan_id: summaryRaw.primaryclanid || null,
        created_at: summaryRaw.timecreated
          ? new Date(summaryRaw.timecreated * 1000).toISOString()
          : null,
        country_code: summaryRaw.loccountrycode || null,
        state_code: summaryRaw.locstatecode || null,
        city_id: summaryRaw.loccityid || null,
        game_extrainfo: summaryRaw.gameextrainfo || null, // Name of the game the user is currently playing
        game_id: summaryRaw.gameid || null,
      };

      if (bansRaw) {
        data.community_banned = bansRaw.CommunityBanned;
        data.vac_banned = bansRaw.VACBanned;
        data.vac_bans_count = bansRaw.NumberOfVACBans;
        data.days_since_last_ban = bansRaw.DaysSinceLastBan;
        data.game_bans_count = bansRaw.NumberOfGameBans;
        data.economy_ban_state = bansRaw.EconomyBan; // e.g. "none"
      }

      // Calculate owned games & playtime stats
      if (ownedGamesRaw) {
        data.game_count = ownedGamesRaw.game_count || 0;
        
        const games = ownedGamesRaw.games || [];
        if (games.length > 0) {
          let totalPlaytimeMinutes = 0;
          let maxPlaytimeGame: SteamOwnedGame | null = null;

          for (const g of games) {
            totalPlaytimeMinutes += g.playtime_forever || 0;
            if (!maxPlaytimeGame || (g.playtime_forever || 0) > (maxPlaytimeGame.playtime_forever || 0)) {
              maxPlaytimeGame = g;
            }
          }

          data.total_playtime_hours = Math.round((totalPlaytimeMinutes / 60) * 10) / 10;

          if (maxPlaytimeGame) {
            data.most_played_game = {
              appid: maxPlaytimeGame.appid,
              name: maxPlaytimeGame.name || `App ${maxPlaytimeGame.appid}`,
              playtime_hours: Math.round(((maxPlaytimeGame.playtime_forever ?? 0) / 60) * 10) / 10,
            };
          }
        } else {
          data.total_playtime_hours = 0;
          data.most_played_game = null;
        }
      } else {
        data.game_count = null;
        data.total_playtime_hours = null;
        data.most_played_game = null;
      }

      return {
        provider: PROVIDER_NAME,
        success: true,
        data,
        raw: { summary: summaryRaw, bans: bansRaw, owned_games: ownedGamesRaw },
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
