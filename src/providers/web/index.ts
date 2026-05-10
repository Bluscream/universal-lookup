import * as cheerio from 'cheerio';
import { config } from '../../config.js';
import { scrapeWithPuppeteer } from '../../lib/puppeteer.js';
import { filterAndSortProviders } from '../../lib/providers.js';
import type { Provider, ProviderResult, SearchResult } from '../../types/common.js';



async function scrape(
  url: string,
  selector: string,
  providerName: string,
  // biome-ignore lint/suspicious/noExplicitAny: Puppeteer/Cheerio element
  mapper: ($el: any) => { text: string; url: string } | null,
): Promise<SearchResult[]> {
  try {
    const html = await scrapeWithPuppeteer(url, selector);
    const $ = cheerio.load(html);
    const results: SearchResult[] = [];

    $(selector).each((_, el) => {
      if (results.length >= config.universalResultsLimit) return;
      const res = mapper($(el));
      if (res?.text && res.url) {
        results.push({ ...res, provider: providerName });
      }
    });
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
      '.g, .tF2Cxc, .MjjYud, div[data-hveid]',
      'google',
      ($el) => {
        const title = $el.find('h3').text().trim();
        const link = $el.find('a').attr('href') || '';
        if (!title || !link) return null;
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
      '.b_algo, .b_result, li.b_algo',
      'bing',
      ($el) => {
        const title = $el.find('h2').text().trim();
        const link = $el.find('a').attr('href') || '';
        if (!title || !link) return null;
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
      '.result, .result__body',
      'duckduckgo',
      ($el) => {
        const title = $el.find('.result__title, h2').text().trim();
        const link = $el.find('a.result__a, a').attr('href') || '';
        if (!title || !link) return null;
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
      ($el) => {
        const title = $el.find('h3, .title').text().trim();
        const link = $el.find('a').attr('href') || '';
        if (!title || !link) return null;
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
