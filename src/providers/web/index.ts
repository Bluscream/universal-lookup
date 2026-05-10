import axios from 'axios';
import * as cheerio from 'cheerio';
import { config } from '../../config.js';
import type { Provider, ProviderResult } from '../../types/common.js';
import { filterAndSortProviders } from '../../lib/providers.js';

export interface SearchResult {
  text: string;
  url: string;
  provider: string;
}

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

async function scrape(
  url: string,
  selector: string,
  providerName: string,
  // biome-ignore lint/suspicious/noExplicitAny: Cheerio element type is complex to export correctly here
  mapper: ($: cheerio.CheerioAPI, el: any) => { text: string; url: string } | null,
): Promise<SearchResult[]> {
  try {
    const { data } = await axios.get(url, {
      headers: { 'User-Agent': USER_AGENT },
      timeout: config.providerTimeout,
    });
    const $ = cheerio.load(data);
    const results: SearchResult[] = [];
    const elements = $(selector).get();
    for (const el of elements) {
      if (results.length >= config.universalResultsLimit) break;
      const res = mapper($, el);
      if (res?.text && res.url) {
        results.push({ ...res, provider: providerName });
      }
    }
    return results;
  } catch (error) {
    console.error(`Error scraping ${url}:`, error);
    return [];
  }
}

export const googleProvider: Provider = {
  name: 'google',
  isAvailable: () => true,
  lookup: async (query: string): Promise<ProviderResult> => {
    const start = Date.now();
    const results = await scrape(
      `https://www.google.com/search?q=${encodeURIComponent(query)}`,
      '.g',
      'google',
      ($, el) => {
        const title = $(el).find('h3').text().trim();
        const link = $(el).find('a').attr('href') || '';
        return { text: title, url: link };
      },
    );
    return {
      provider: 'google',
      success: results.length > 0,
      data: { web_results: results },
      error: results.length === 0 ? 'No results found' : undefined,
      duration: Date.now() - start,
    };
  },
};

export const bingProvider: Provider = {
  name: 'bing',
  isAvailable: () => true,
  lookup: async (query: string): Promise<ProviderResult> => {
    const start = Date.now();
    const results = await scrape(
      `https://www.bing.com/search?q=${encodeURIComponent(query)}`,
      '.b_algo',
      'bing',
      ($, el) => {
        const title = $(el).find('h2').text().trim();
        const link = $(el).find('a').attr('href') || '';
        return { text: title, url: link };
      },
    );
    return {
      provider: 'bing',
      success: results.length > 0,
      data: { web_results: results },
      error: results.length === 0 ? 'No results found' : undefined,
      duration: Date.now() - start,
    };
  },
};

export const duckduckgoProvider: Provider = {
  name: 'duckduckgo',
  isAvailable: () => true,
  lookup: async (query: string): Promise<ProviderResult> => {
    const start = Date.now();
    const results = await scrape(
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
      '.result',
      'duckduckgo',
      ($, el) => {
        const title = $(el).find('.result__title').text().trim();
        const link = $(el).find('.result__url').attr('href')?.trim() || '';
        return { text: title, url: link };
      },
    );
    return {
      provider: 'duckduckgo',
      success: results.length > 0,
      data: { web_results: results },
      error: results.length === 0 ? 'No results found' : undefined,
      duration: Date.now() - start,
    };
  },
};

export const yahooProvider: Provider = {
  name: 'yahoo',
  isAvailable: () => true,
  lookup: async (query: string): Promise<ProviderResult> => {
    const start = Date.now();
    const results = await scrape(
      `https://search.yahoo.com/search?p=${encodeURIComponent(query)}`,
      '.algo',
      'yahoo',
      ($, el) => {
        const title = $(el).find('h3').text().trim();
        const link = $(el).find('a').attr('href') || '';
        return { text: title, url: link };
      },
    );
    return {
      provider: 'yahoo',
      success: results.length > 0,
      data: { web_results: results },
      error: results.length === 0 ? 'No results found' : undefined,
      duration: Date.now() - start,
    };
  },
};

const ALL_WEB_PROVIDERS = [googleProvider, bingProvider, duckduckgoProvider, yahooProvider];

export async function lookupWeb(query: string): Promise<ProviderResult[]> {
  const providers = filterAndSortProviders(ALL_WEB_PROVIDERS, config.providersWeb);

  const results = await Promise.allSettled(
    providers.map((provider) =>
      Promise.race([
        provider.lookup(query),
        new Promise<ProviderResult>((_, reject) =>
          setTimeout(() => reject(new Error(`${provider.name} provider timed out`)), config.providerTimeout + 2000),
        ),
      ]).catch(
        (error): ProviderResult => ({
          provider: provider.name,
          success: false,
          data: {},
          error: error instanceof Error ? error.message : String(error),
          duration: config.providerTimeout,
        }),
      ),
    ),
  );

  return results.map((r) =>
    r.status === 'fulfilled'
      ? r.value
      : {
          provider: 'unknown',
          success: false,
          data: {},
          error: 'Promise rejected',
          duration: 0,
        },
  );
}
