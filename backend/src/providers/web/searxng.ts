import axios from 'axios';
import * as cheerio from 'cheerio';
import { config } from '../../config.js';
import type {
  LookupType,
  Provider,
  ProviderResult,
  SearchResult,
  WebData,
} from '../../types/common.js';

const PROVIDER_NAME = 'searxng';

/**
 * What to tell someone whose instance refuses the JSON API. SearXNG ships with
 * `json` absent from `search.formats`, and an instance in that state answers
 * the documented `&format=json` request with a 403 and an HTML body rather than
 * with an error a client could read. Without naming the setting, the symptom is
 * indistinguishable from "the search found nothing".
 */
function jsonDisabledMessage(base: string, detail: string): string {
  return (
    `The SearXNG instance at ${base} refused the JSON API (${detail}). ` +
    'Most instances ship with it disabled: add `json` to `search.formats` in ' +
    'settings.yml and restart the instance.'
  );
}

interface SearxngJsonResult {
  title?: string;
  url?: string;
  content?: string;
}

/** The instance's search endpoint, built from the configured base URL. */
function searchUrl(query: string, format?: 'json'): URL {
  const url = new URL('search', `${config.searxngUrl.replace(/\/+$/, '')}/`);
  url.searchParams.set('q', query);
  if (format) url.searchParams.set('format', format);
  return url;
}

function toSearchResults(items: SearxngJsonResult[], limit?: number): SearchResult[] {
  const results: SearchResult[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (limit !== undefined && results.length >= limit) break;
    const title = (item.title ?? '').trim();
    const url = (item.url ?? '').trim();
    if (!title || !url || seen.has(url)) continue;
    seen.add(url);
    results.push({
      title,
      url,
      description: (item.content ?? '').trim(),
      provider: PROVIDER_NAME,
    });
  }
  return results;
}

/**
 * SearXNG's own result markup. Only used once the JSON attempt has failed and
 * said why — the HTML is a presentation format and will drift, so it is the
 * fallback rather than the primary path.
 */
function parseHtml(html: string, limit?: number): SearchResult[] {
  const $ = cheerio.load(html);
  const items: SearxngJsonResult[] = [];
  $('article.result').each((_, el) => {
    const $el = $(el);
    items.push({
      title: $el.find('h3').first().text().trim(),
      url: $el.find('h3 a').first().attr('href') ?? $el.find('a.url_header').first().attr('href'),
      content: $el.find('p.content').first().text().trim(),
    });
  });
  return toSearchResults(items, limit);
}

function transportMessage(base: string, error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  return `Could not reach the SearXNG instance at ${base}: ${detail}.`;
}

/** Non-2xx, or a 2xx that is not the JSON document we asked for. */
function jsonProblem(status: number, contentType: string, data: unknown): string | undefined {
  if (status < 200 || status >= 300) return `HTTP ${status}`;
  if (!contentType.includes('json')) return `a ${contentType || 'non-JSON'} body`;
  if (typeof data !== 'object' || data === null) return 'a body that is not a JSON object';
  return undefined;
}

export const searxngProvider: Provider = {
  name: PROVIDER_NAME,
  // Empty SEARXNG_URL means "no instance configured", which is a skip rather
  // than a failure on every lookup. There is deliberately no default host: the
  // container-gateway address this was written for (http://172.17.0.1:28080) is
  // right for exactly one deployment and would make every other install fail a
  // connection on each search.
  isAvailable: () => config.searxngUrl.length > 0,
  lookup: async (query: string, type?: LookupType): Promise<ProviderResult<WebData>> => {
    const start = Date.now();
    const base = config.searxngUrl.replace(/\/+$/, '');
    const limit = type === 'web' ? undefined : config.universalResultsLimit;
    const done = (
      results: SearchResult[],
      error: string | undefined,
      raw: unknown,
    ): ProviderResult<WebData> => ({
      provider: PROVIDER_NAME,
      success: results.length > 0,
      data: { web: results },
      raw,
      error: results.length > 0 ? undefined : error,
      duration: Date.now() - start,
    });

    if (!base) {
      return done([], 'SearXNG is not configured. Set SEARXNG_URL to your instance.', undefined);
    }

    const request = { timeout: config.searxngTimeout, validateStatus: () => true };

    let jsonError: string;
    try {
      const resp = await axios.get(searchUrl(query, 'json').toString(), request);
      const contentType = String(resp.headers?.['content-type'] ?? '');
      const problem = jsonProblem(resp.status, contentType, resp.data);
      if (!problem) {
        const items: SearxngJsonResult[] = Array.isArray(resp.data?.results)
          ? resp.data.results
          : [];
        const results = toSearchResults(items, limit);
        return done(results, `No results found on the SearXNG instance at ${base}.`, resp.data);
      }
      jsonError = jsonDisabledMessage(base, problem);
    } catch (error) {
      // A transport failure is not a format problem, and saying otherwise would
      // send someone editing settings.yml on a host that was never reachable.
      return done([], transportMessage(base, error), undefined);
    }

    console.warn(`${jsonError} Falling back to parsing its HTML.`);

    try {
      const resp = await axios.get(searchUrl(query).toString(), request);
      if (resp.status < 200 || resp.status >= 300) {
        return done([], `${jsonError} The HTML page answered HTTP ${resp.status}.`, undefined);
      }
      const results = parseHtml(String(resp.data), limit);
      return done(
        results,
        `${jsonError} Its HTML page returned no results for this query either.`,
        { html_fallback: true, json_api_error: jsonError, results },
      );
    } catch (error) {
      return done([], `${jsonError} ${transportMessage(base, error)}`, undefined);
    }
  },
};
