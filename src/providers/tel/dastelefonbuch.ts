import axios from 'axios';
import * as cheerio from 'cheerio';
import { config } from '../../config.js';
import type { LookupType, Provider, ProviderResult } from '../../types/common.js';

const PROVIDER_NAME = 'dastelefonbuch';

export const dastelefonbuch: Provider = {
  name: PROVIDER_NAME,
  isAvailable() {
    return true;
  },

  async lookup(query: string, _type?: LookupType): Promise<ProviderResult> {
    const start = Date.now();
    try {
      // dastelefonbuch Rückwärts-Suche accepts both national 0xxx and 0049xxx formats
      const num = query.replace(/^0049/, '0').replace(/^00/, '');
      const url = `https://www.dastelefonbuch.de/R%C3%BCckw%C3%A4rts-Suche/${encodeURIComponent(num)}`;
      const resp = await axios.get(url, {
        timeout: config.providerTimeout,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8',
          Accept: 'text/html,application/xhtml+xml',
          Referer: 'https://www.dastelefonbuch.de/',
        },
      });

      const $ = cheerio.load(resp.data);
      const data: Record<string, unknown> = {};

      // Extract from first entry using data-entry-data attribute
      const entryEl = $('[data-entry-data]').first();
      if (entryEl.length) {
        const entryData = entryEl.attr('data-entry-data') || '';
        const params = new URLSearchParams(entryData);
        const entryName = params.get('na');
        if (entryName) data.name = decodeURIComponent(entryName.replace(/\+/g, ' '));
      }

      // Extract from vcard structure
      const vcard = $('.vcard').first();
      if (vcard.length) {
        const name = vcard.find('[itemprop="name"]').first().text().trim();
        if (name && !data.name) data.name = name;

        const street = vcard.find('[itemprop="streetAddress"]').first().text().trim();
        if (street) data.street = street;

        const zip = vcard.find('[itemprop="postalCode"]').first().text().trim();
        if (zip) data.postal_code = zip;

        const city = vcard.find('[itemprop="addressLocality"]').first().text().trim();
        if (city) data.city = city;

        const phone = vcard.find('[itemprop="telephone"]').first().text().trim();
        if (phone) data.phone_formatted = phone;
      }

      // Fallback: try .name div title attribute
      if (!data.name) {
        const nameDiv = $('div.name[title]').first();
        if (nameDiv.length) data.name = nameDiv.attr('title')?.trim();
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
