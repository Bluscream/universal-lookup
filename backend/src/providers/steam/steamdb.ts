import { scrapeWithPuppeteer } from '../../lib/puppeteer.js';
import type { LookupType, Provider, ProviderResult, SteamData } from '../../types/common.js';

const PROVIDER_NAME = 'steam-db';

/**
 * steam-db — scrapes the SteamDB calculator for library value, total games and playtime.
 *
 * SteamDB sits behind a Cloudflare interactive challenge and publishes no API,
 * so this is best-effort and frequently returns nothing. Prefer the official
 * Steam Web API providers for anything that must be reliable.
 */
export const steamDbProvider: Provider = {
  name: PROVIDER_NAME,

  isAvailable() {
    return true; // Universally available
  },

  async lookup(query: string, _type?: LookupType): Promise<ProviderResult<SteamData>> {
    const start = Date.now();
    const steamId = query.trim();
    const url = `https://steamdb.info/calculator/${steamId}/?cc=us`;

    try {
      const html = await scrapeWithPuppeteer(url);

      // Parse values using resilient regexes
      const priceTodayMatch =
        html.match(/Today's prices<\/span>\s*<span[^>]*>([^<]+)<\/span>/i) ||
        html.match(/<span>Today's prices<\/span>\s*<b>([^<]+)<\/b>/i) ||
        html.match(/Today's prices[\s\S]*?currency-us">([^<]+)/i);

      const priceLowestMatch =
        html.match(/Lowest prices<\/span>\s*<span[^>]*>([^<]+)<\/span>/i) ||
        html.match(/<span>Lowest prices<\/span>\s*<b>([^<]+)<\/b>/i) ||
        html.match(/Lowest prices[\s\S]*?currency-us">([^<]+)/i);

      const gamesOwnedMatch =
        html.match(/Games owned<\/span>\s*<span[^>]*>([^<]+)<\/span>/i) ||
        html.match(/<span>Games owned<\/span>\s*<b>([^<]+)<\/b>/i) ||
        html.match(/Games owned[\s\S]*?number">([^<]+)/i);

      const hoursMatch =
        html.match(/Hours on record<\/span>\s*<span[^>]*>([^<]+)<\/span>/i) ||
        html.match(/<span>Hours on record<\/span>\s*<b>([^<]+)<\/b>/i) ||
        html.match(/Hours on record[\s\S]*?number">([^<]+)/i);

      if (!priceTodayMatch && !priceLowestMatch && !gamesOwnedMatch) {
        // If we received an HTML that does not look like SteamDB calculator (e.g. still blocked)
        return {
          provider: PROVIDER_NAME,
          success: false,
          data: {},
          error: 'Failed to bypass Cloudflare Turnstile block or parse HTML structure',
          duration: Date.now() - start,
        };
      }

      return {
        provider: PROVIDER_NAME,
        success: true,
        data: {
          price_today: priceTodayMatch ? priceTodayMatch[1].trim() : null,
          price_lowest: priceLowestMatch ? priceLowestMatch[1].trim() : null,
          games_owned: gamesOwnedMatch ? parseInt(gamesOwnedMatch[1].replace(/,/g, ''), 10) : null,
          hours_played: hoursMatch ? parseFloat(hoursMatch[1].replace(/,/g, '')) : null,
        },
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
