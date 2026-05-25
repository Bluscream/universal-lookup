import axios from 'axios';
import * as cheerio from 'cheerio';
import { config } from '../../config.js';
import type { LookupType, Provider, ProviderResult } from '../../types/common.js';

const PROVIDER_NAME = 'steam-xml';

/**
 * steam-xml — Public XML feed of Steam profiles.
 * Safe fallback that works without Steam API keys.
 */
export const steamXmlProvider: Provider = {
  name: PROVIDER_NAME,

  isAvailable() {
    return true; // Publicly available XML
  },

  async lookup(query: string, _type?: LookupType): Promise<ProviderResult> {
    const start = Date.now();

    try {
      // Determine if we should query profiles or id
      const isId64 = /^[0-9]{17}$/.test(query);
      const url = isId64
        ? `https://steamcommunity.com/profiles/${query}/?xml=1`
        : `https://steamcommunity.com/id/${query}/?xml=1`;

      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
        timeout: config.serverTimeout,
      });

      const $ = cheerio.load(response.data, { xmlMode: true });

      // If profile element is empty or has error
      if ($('error').length > 0) {
        return {
          provider: PROVIDER_NAME,
          success: false,
          data: {},
          raw: response.data,
          error: $('error').text() || 'Profile not found or private',
          duration: Date.now() - start,
        };
      }

      const steamID64 = $('profile > steamID64').text();
      const steamID = $('profile > steamID').text(); // Username / Display Name

      if (!steamID64) {
        return {
          provider: PROVIDER_NAME,
          success: false,
          data: {},
          raw: response.data,
          error: 'No profile details found in XML response',
          duration: Date.now() - start,
        };
      }

      const data: Record<string, unknown> = {
        steam_id_64: steamID64,
        username: steamID,
        headline: $('profile > headline').text() || null,
        summary: $('profile > summary').text() || null,
        state_message: $('profile > stateMessage').text() || null,
        privacy_state: $('profile > privacyState').text() || null,
        avatar_icon: $('profile > avatarIcon').text() || null,
        avatar_medium: $('profile > avatarMedium').text() || null,
        avatar_full: $('profile > avatarFull').text() || null,
        vac_banned: $('profile > vacBanned').text() === '1',
        trade_ban_state: $('profile > tradeBanState').text() || 'None',
        is_limited_account: $('profile > isLimitedAccount').text() === '1',
        custom_url: $('profile > customURL').text() || null,
        member_since: $('profile > memberSince').text() || null,
      };

      return {
        provider: PROVIDER_NAME,
        success: true,
        data,
        raw: data, // Return parsed data as raw structure
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
