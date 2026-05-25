import axios from 'axios';
import * as cheerio from 'cheerio';
import { config } from '../../config.js';
import type { LookupType, Provider, ProviderResult } from '../../types/common.js';

const PROVIDER_NAME = 'dasoertliche';

export const dasoertliche: Provider = {
  name: PROVIDER_NAME,
  isAvailable() {
    return true;
  },

  async lookup(query: string, _type?: LookupType): Promise<ProviderResult> {
    const start = Date.now();
    try {
      const num = query.replace(/^0049/, '0').replace(/^00/, '');
      const url = `https://www.dasoertliche.de/rueckwaertssuche/?ph=${encodeURIComponent(num)}`;
      const resp = await axios.get(url, {
        timeout: config.serverTimeout,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept-Language': 'de-DE,de;q=0.9',
          Referer: 'https://www.dasoertliche.de/',
        },
      });

      const $ = cheerio.load(resp.data);
      const data: Record<string, unknown> = {};

      const entry = $(
        '[itemtype*="Person"], [itemtype*="Organization"], .hit, .entry, [class*="hititem"]',
      ).first();
      if (entry.length) {
        const name = entry.find('[itemprop="name"], .name, .hitlnk_name').first().text().trim();
        if (name) data.name = name;

        const street = entry.find('[itemprop="streetAddress"], .street').first().text().trim();
        if (street) data.street = street;

        const zip = entry.find('[itemprop="postalCode"]').first().text().trim();
        if (zip) data.postal_code = zip;

        const city = entry.find('[itemprop="addressLocality"], .city').first().text().trim();
        if (city) data.city = city;

        const phone = entry.find('[itemprop="telephone"]').first().text().trim();
        if (phone) data.phone = phone;
      }

      return {
        provider: PROVIDER_NAME,
        success: Object.keys(data).length > 0,
        data,
        raw: resp.data,
        error: Object.keys(data).length === 0 ? 'No results found' : undefined,
        duration: Date.now() - start,
      };
    } catch (error) {
      if (
        axios.isAxiosError(error) &&
        (error.response?.status === 404 || error.response?.status === 410)
      ) {
        return {
          provider: PROVIDER_NAME,
          success: false,
          data: {},
          error: 'No results found',
          duration: Date.now() - start,
        };
      }
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
