import * as cheerio from 'cheerio';
import { config } from '../../config.js';
import { scrapeWithPuppeteer } from '../../lib/puppeteer.js';
import { filterAndSortProviders } from '../../lib/providers.js';
import type { Provider, ProviderResult, SearchResult } from '../../types/common.js';



function cleanUrl(url: string): string {
  if (!url) return '';
  try {
    const u = new URL(url, 'https://www.google.com');
    // Google redirect
    if (u.pathname === '/url' && u.searchParams.has('q')) {
      return u.searchParams.get('q') || url;
    }
    // DuckDuckGo redirect (https://duckduckgo.com/l/?uddg=...)
    if ((u.hostname.includes('duckduckgo.com') || u.hostname === 'www.google.com') && u.pathname === '/l/' && u.searchParams.has('uddg')) {
      return u.searchParams.get('uddg') || url;
    }
    // Generic cleanup (remove common tracking params)
    const trackingParams = ['utm_source', 'utm_medium', 'utm_campaign', 'cvid', 'FORM', 'pq'];
    for (const p of trackingParams) {
      u.searchParams.delete(p);
    }
    return u.toString();
  } catch {
    return url;
  }
}

async function scrape(
  url: string,
  selector: string,
  providerName: string,
  // biome-ignore lint/suspicious/noExplicitAny: Puppeteer/Cheerio element
  mapper: ($el: any) => { title: string; url: string; description: string } | null,
): Promise<SearchResult[]> {
  try {
    const html = await scrapeWithPuppeteer(url, selector);
    const $ = cheerio.load(html);
    const results: SearchResult[] = [];

    $(selector).each((_, el) => {
      if (results.length >= config.universalResultsLimit) return;
      const res = mapper($(el));
      if (res?.title && res.url) {
        results.push({ ...res, url: cleanUrl(res.url), provider: providerName });
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
        // Skip ads
        if ($el.hasClass('ads-ad') || $el.find('.commercial-unit-desktop-top').length > 0) return null;
        
        const title = $el.find('h3').text().trim();
        const link = $el.find('a').attr('href') || '';
        const desc = $el.find('div[style*="-webkit-line-clamp"], .VwiC3b, .yXK7lf').text().trim();
        
        if (!title || !link || title.includes('Ad ·')) return null;
        return { title, url: link, description: desc };
      },
    );
    return {
      provider: 'google',
      success: results.length > 0,
      data: { web: results },
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
        const desc = $el.find('.b_caption p, .b_snippet').text().trim();
        if (!title || !link) return null;
        return { title, url: link, description: desc };
      },
    );
    return {
      provider: 'bing',
      success: results.length > 0,
      data: { web: results },
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
        // Skip ads
        if ($el.hasClass('result--ad') || $el.find('.result__badge--ad').length > 0) return null;

        const title = $el.find('.result__title, h2').text().trim();
        const link = $el.find('a.result__a, a').attr('href') || '';
        const desc = $el.find('.result__snippet').text().trim();
        
        // Final check for "Ad" text in title or description as fallback
        const isAd = 
          title.toLowerCase().includes(' ad ') || 
          title.toLowerCase().includes('\nad\n') ||
          /\sAd\s/i.test(title) ||
          desc.includes('Viewing ads is privacy protected') ||
          link.includes('ad_domain=') ||
          link.includes('y.js?');

        if (!title || !link || isAd) return null;
        
        return { title, url: link, description: desc };
      },
    );
    return {
      provider: 'duckduckgo',
      success: results.length > 0,
      data: { web: results },
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
        const desc = $el.find('.compText, .algo-desc').text().trim();
        if (!title || !link) return null;
        return { title, url: link, description: desc };
      },
    );
    return {
      provider: 'yahoo',
      success: results.length > 0,
      data: { web: results },
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
