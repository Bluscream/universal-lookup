import axios from 'axios';
import * as cheerio from 'cheerio';
import { config } from '../../config.js';
import { filterAndSortProviders } from '../../lib/providers.js';
import { scrapeWithPuppeteer } from '../../lib/puppeteer.js';
import type { LookupType, Provider, ProviderResult, SearchResult } from '../../types/common.js';

function cleanUrl(url: string): string {
  if (!url) return '';
  try {
    const u = new URL(url, 'https://www.google.com');

    // Google redirect
    if (u.pathname === '/url' && u.searchParams.has('q')) {
      return u.searchParams.get('q') || url;
    }

    // Bing redirect (https://www.bing.com/ck/a?...!&u=a1<BASE64>&ntb=1)
    if (u.hostname.includes('bing.com') && u.pathname === '/ck/a' && u.searchParams.has('u')) {
      let b64 = u.searchParams.get('u') || '';
      if (b64.startsWith('a1')) {
        b64 = b64.substring(2);
        // Add padding if necessary
        while (b64.length % 4 !== 0) b64 += '=';
        try {
          return Buffer.from(b64, 'base64').toString('utf8');
        } catch {
          /* ignore */
        }
      }
    }

    // DuckDuckGo redirect (https://duckduckgo.com/l/?uddg=...)
    if (
      (u.hostname.includes('duckduckgo.com') || u.hostname === 'www.google.com') &&
      u.pathname === '/l/' &&
      u.searchParams.has('uddg')
    ) {
      return u.searchParams.get('uddg') || url;
    }

    // Generic cleanup (remove common tracking params)
    const trackingParams = [
      'utm_source',
      'utm_medium',
      'utm_campaign',
      'utm_term',
      'utm_content',
      'cvid',
      'FORM',
      'pq',
      'msclkid',
      'gclid',
      'fbclid',
    ];
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
  limit?: number,
): Promise<SearchResult[]> {
  try {
    const html = await scrapeWithPuppeteer(url, selector);
    const $ = cheerio.load(html);
    const results: SearchResult[] = [];

    const seenUrls = new Set<string>();
    $(selector).each((_, el) => {
      if (limit !== undefined && results.length >= limit) return;
      const res = mapper($(el));
      if (res?.title && res.url) {
        const cleaned = cleanUrl(res.url);
        if (!seenUrls.has(cleaned)) {
          seenUrls.add(cleaned);
          results.push({ ...res, url: cleaned, provider: providerName });
        }
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
  lookup: async (query: string, type?: LookupType): Promise<ProviderResult> => {
    const start = Date.now();
    const limit = type === 'web' ? undefined : config.universalResultsLimit;

    // Use Official API if configured
    if (config.googleApiKey && config.googleSearchCx) {
      try {
        const url = `https://www.googleapis.com/customsearch/v1?key=${config.googleApiKey}&cx=${config.googleSearchCx}&q=${encodeURIComponent(query)}&num=${limit || 10}`;
        const resp = await axios.get(url, { timeout: config.providerTimeout });
        const items = resp.data.items || [];
        const results: SearchResult[] = items.map((item: any) => ({
          title: item.title,
          url: item.link,
          description: item.snippet,
          provider: 'google-api',
        }));
        return {
          provider: 'google',
          success: results.length > 0,
          data: { web: results },
          raw: resp.data,
          duration: Date.now() - start,
        };
      } catch (error) {
        console.warn('Google Search API failed, falling back to scraping:', error instanceof Error ? error.message : error);
      }
    }

    // Fallback to Scraping
    const results = await scrape(
      `https://www.google.com/search?q=${encodeURIComponent(query)}`,
      '.g',
      'google',
      ($el) => {
        // Skip ads
        if ($el.hasClass('ads-ad') || $el.find('.commercial-unit-desktop-top').length > 0)
          return null;

        const title = $el.find('h3').text().trim();
        const link = $el.find('a').attr('href') || '';
        const desc = $el.find('div[style*="-webkit-line-clamp"], .VwiC3b, .yXK7lf').text().trim();

        if (!title || !link || title.includes('Ad ·')) return null;
        return { title, url: link, description: desc };
      },
      limit,
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
  lookup: async (query: string, type?: LookupType): Promise<ProviderResult> => {
    const start = Date.now();
    const limit = type === 'web' ? undefined : config.universalResultsLimit;
    const results = await scrape(
      `https://www.bing.com/search?q=${encodeURIComponent(query)}`,
      '.b_algo',
      'bing',
      ($el) => {
        const title = $el.find('h2').text().trim();
        const link = $el.find('a').attr('href') || '';
        const desc = $el.find('.b_caption p, .b_snippet').text().trim();
        if (!title || !link) return null;
        return { title, url: link, description: desc };
      },
      limit,
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
  lookup: async (query: string, type?: LookupType): Promise<ProviderResult> => {
    const start = Date.now();
    const limit = type === 'web' ? undefined : config.universalResultsLimit;
    const results = await scrape(
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
      '.result',
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
      limit,
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
  lookup: async (query: string, type?: LookupType): Promise<ProviderResult> => {
    const start = Date.now();
    const limit = type === 'web' ? undefined : config.universalResultsLimit;
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
      limit,
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

export async function lookupWeb(
  query: string,
  type: LookupType = 'web',
): Promise<ProviderResult[]> {
  const providers = filterAndSortProviders(ALL_WEB_PROVIDERS, config.providersWeb);

  const results = await Promise.allSettled(
    providers.map((provider) =>
      Promise.race([
        provider.lookup(query, type),
        new Promise<ProviderResult>((_, reject) =>
          setTimeout(
            () => reject(new Error(`${provider.name} provider timed out`)),
            config.providerTimeout + 2000,
          ),
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
