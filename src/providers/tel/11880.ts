import axios from 'axios';
import * as cheerio from 'cheerio';
import { config } from '../../config.js';
import type { LookupType, Provider, ProviderResult } from '../../types/common.js';

const PROVIDER_NAME = '11880';

export const provider11880: Provider = {
  name: PROVIDER_NAME,
  isAvailable() {
    return true;
  },

  async lookup(query: string, _type?: LookupType): Promise<ProviderResult> {
    const start = Date.now();
    try {
      const num = query.replace(/^0049/, '0').replace(/^00/, '');
      const url = `https://www.11880.com/inverssuche/index/search?phoneNumber=${encodeURIComponent(num)}`;
      const resp = await axios.get(url, {
        timeout: config.serverTimeout,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept-Language': 'de-DE,de;q=0.9',
        },
      });

      const $ = cheerio.load(resp.data);
      const data: Record<string, unknown> = {};

      // Try search result layout
      const entry = $('.result, .entry, [class*="result-item"], [class*="search-result"]').first();
      if (entry.length) {
        const name = entry.find('[class*="name"], h2, h3, .company-name').first().text().trim();
        if (name) data.name = name;

        const address = entry.find('[class*="address"], .street, .addr').first().text().trim();
        if (address) data.address = address;

        const category = entry.find('[class*="category"], [class*="branch"]').first().text().trim();
        if (category) data.category = category;
      } else {
        // Try detail page layout
        const detailEntry = $('#entry, .box-entry-detail').first();
        if (detailEntry.length) {
          const name = detailEntry.find('h1.title, .name').first().text().trim();
          if (name) data.name = name;

          const address = detailEntry.find('.address, .contact-info').first().text().trim();
          if (address) data.address = address;

          const category = $('.category, .branch').first().text().trim();
          if (category) data.category = category;
        }
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
