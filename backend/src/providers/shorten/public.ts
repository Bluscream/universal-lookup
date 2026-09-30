import axios from 'axios';
import { config } from '../../config.js';
import type { Provider, ShortLink } from '../../types/common.js';
import { asProvider, type Shortener } from './shared.js';

/**
 * The key-free public shorteners.
 *
 * Each is one request with no account, no key and no retry. They were picked by
 * calling them: clck.ru, ulvis.net and 1pt.co are in the same family but did not
 * answer at all from here, so they are not registered — a provider that cannot
 * be reached is a provider nobody can tell is broken.
 */

const UA = 'universal-lookup/1.0 (+https://github.com/Bluscream/universal-lookup)';

/** A short URL a service returned as plain text, validated before it is trusted. */
function plainTextLink(
  service: string,
  body: unknown,
  longUrl: string,
): { link: ShortLink } | { error: string } {
  const text = typeof body === 'string' ? body.trim() : '';
  // These endpoints answer HTTP 200 with an error sentence in the body, so the
  // status code alone does not establish success.
  if (!/^https?:\/\/\S+$/.test(text) || text.includes(' ')) {
    return {
      error: `${service} returned no usable short URL: ${text.slice(0, 120) || '(empty body)'}`,
    };
  }
  return { link: { service, short_url: text, long_url: longUrl } };
}

/**
 * A GET with the query string built by hand.
 *
 * Not axios' `params`: its serializer leaves `:` and `/` unescaped, so the URL
 * being shortened goes out raw inside the query string. is.gd tolerates that;
 * TinyURL answers 400 to every request, which is how this was found.
 */
function shortenUrl(endpoint: string, params: Record<string, string>): string {
  return `${endpoint}?${new URLSearchParams(params).toString()}`;
}

/** is.gd and v.gd are the same software on two domains, with a JSON mode. */
function gdShortener(name: string, host: string): Shortener {
  return {
    name,
    async create(url: string) {
      const resp = await axios.get(
        shortenUrl(`https://${host}/create.php`, { format: 'json', url }),
        {
          timeout: config.serverTimeout,
          headers: { 'User-Agent': UA },
        },
      );
      const body = resp.data as { shorturl?: string; errorcode?: number; errormessage?: string };
      if (!body?.shorturl) {
        const detail = body?.errormessage ?? JSON.stringify(body ?? null).slice(0, 120);
        return { error: `${name} refused the URL: ${detail}`, raw: body };
      }
      return { link: { service: name, short_url: body.shorturl, long_url: url }, raw: body };
    },
  };
}

const isGd = gdShortener('is.gd', 'is.gd');
const vGd = gdShortener('v.gd', 'v.gd');

/** A service whose whole answer is the short URL as a line of text. */
function plainTextShortener(name: string, endpoint: string): Shortener {
  return {
    name,
    async create(url: string) {
      const resp = await axios.get(shortenUrl(endpoint, { url }), {
        timeout: config.serverTimeout,
        headers: { 'User-Agent': UA },
        responseType: 'text',
      });
      return { ...plainTextLink(name, resp.data, url), raw: resp.data };
    },
  };
}

const daGd = plainTextShortener('da.gd', 'https://da.gd/shorten');

// The plain api-create.php endpoint, which needs no account. TinyURL's newer v2
// API does, and is deliberately not used here.
const tinyurl = plainTextShortener('tinyurl', 'https://tinyurl.com/api-create.php');

const spooMe: Shortener = {
  name: 'spoo.me',
  async create(url: string) {
    const resp = await axios.post('https://spoo.me/', new URLSearchParams({ url }).toString(), {
      timeout: config.serverTimeout,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': UA,
      },
    });
    const body = resp.data as { short_url?: string; original_url?: string; error?: string };
    if (!body?.short_url) {
      const detail = body?.error ?? JSON.stringify(body ?? null).slice(0, 120);
      return { error: `spoo.me refused the URL: ${detail}`, raw: body };
    }
    return {
      link: { service: 'spoo.me', short_url: body.short_url, long_url: body.original_url ?? url },
      raw: body,
    };
  },
};

const cleanuri: Shortener = {
  name: 'cleanuri',
  async create(url: string) {
    const resp = await axios.post(
      'https://cleanuri.com/api/v1/shorten',
      new URLSearchParams({ url }).toString(),
      {
        timeout: config.serverTimeout,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
      },
    );
    const body = resp.data as { result_url?: string; error?: string };
    if (!body?.result_url) {
      const detail = body?.error ?? JSON.stringify(body ?? null).slice(0, 120);
      return { error: `cleanuri refused the URL: ${detail}`, raw: body };
    }
    return { link: { service: 'cleanuri', short_url: body.result_url, long_url: url }, raw: body };
  },
};

/** In the order they are offered; nothing here depends on the order. */
export const PUBLIC_SHORTENERS: Shortener[] = [isGd, vGd, daGd, tinyurl, spooMe, cleanuri];

export const publicProviders: Provider[] = PUBLIC_SHORTENERS.map(asProvider);
