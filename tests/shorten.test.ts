import axios from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../backend/src/config.js';
import { detectType, normalizeQuery } from '../backend/src/lib/normalizer.js';
import { PROVIDER_NAMES, PROVIDERS } from '../backend/src/providers/shorten/index.js';
import { yourls } from '../backend/src/providers/shorten/yourls.js';
import type { Provider, ShortenData, ShortLink } from '../backend/src/types/common.js';

/**
 * Every provider here writes: a request creates a real short link on somebody
 * else's server. Nothing in this suite may touch the network, and the tests that
 * matter most are the ones about *not* answering — an empty result that reads
 * like a short link is worse here than anywhere else, because the next thing the
 * caller does is publish it.
 */
vi.mock('axios');

const mockedAxios = vi.mocked(axios, true);

const LONG = 'https://example.com/';

function provider(name: string): Provider {
  const found = PROVIDERS.find((p) => p.name === name);
  if (!found) throw new Error(`no ${name} provider — renamed?`);
  return found;
}

/** The one short link a provider produced, or a failure if it produced none. */
async function linkFrom(name: string, query = LONG): Promise<ShortLink> {
  const result = (await provider(name).lookup(query, 'shorten')) as { data: ShortenData };
  const links = result.data.short_links ?? [];
  if (links.length !== 1) throw new Error(`${name} returned ${links.length} links, expected 1`);
  return links[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  config.yourlsApiUrl = '';
  config.yourlsSignature = '';
  config.yourlsUsername = '';
  config.yourlsPassword = '';
});

describe('shorten stays explicit-only', () => {
  // A bare URL belongs to the `url` lookup, which reads metadata. If detection
  // ever sent one here instead, every /auto/ lookup of a link would silently
  // create short links on six services.
  it('is never auto-detected', () => {
    expect(detectType('https://example.com')).toBe('url');
    expect(detectType('example.com')).not.toBe('shorten');
  });

  it('normalizes its query the same way the url lookup does', async () => {
    // So that "example.com" and "https://example.com" are one cache entry, and
    // asking twice does not create two sets of links.
    expect(await normalizeQuery('shorten', 'example.com')).toBe(LONG);
    expect(await normalizeQuery('shorten', ' https://example.com ')).toBe(LONG);
  });
});

describe('parsing each service', () => {
  it('reads the is.gd / v.gd JSON body', async () => {
    mockedAxios.get.mockResolvedValue({ data: { shorturl: 'https://is.gd/abc123' } } as never);
    expect(await linkFrom('is.gd')).toMatchObject({
      service: 'is.gd',
      short_url: 'https://is.gd/abc123',
      long_url: LONG,
    });
  });

  it('reads da.gd and tinyurl, which answer with the bare URL', async () => {
    mockedAxios.get.mockResolvedValue({ data: 'https://da.gd/xL0Id\n' } as never);
    expect((await linkFrom('da.gd')).short_url).toBe('https://da.gd/xL0Id');

    mockedAxios.get.mockResolvedValue({ data: 'https://tinyurl.com/peakb' } as never);
    expect((await linkFrom('tinyurl')).short_url).toBe('https://tinyurl.com/peakb');
  });

  it('reads the spoo.me JSON body', async () => {
    mockedAxios.post.mockResolvedValue({
      data: { short_url: 'http://spoo.me/vZIE9H', original_url: LONG, domain: 'spoo.me' },
    } as never);
    expect(await linkFrom('spoo.me')).toMatchObject({
      service: 'spoo.me',
      short_url: 'http://spoo.me/vZIE9H',
      long_url: LONG,
    });
  });

  it('reads the cleanuri JSON body', async () => {
    mockedAxios.post.mockResolvedValue({
      data: { result_url: 'https://cleanuri.com/qnLwMj' },
    } as never);
    expect((await linkFrom('cleanuri')).short_url).toBe('https://cleanuri.com/qnLwMj');
  });

  it('fills the flat short_url as well as the list, so a client can ignore providers', async () => {
    mockedAxios.get.mockResolvedValue({ data: { shorturl: 'https://is.gd/abc123' } } as never);
    const result = await provider('is.gd').lookup(LONG, 'shorten');
    expect(result.success).toBe(true);
    expect((result.data as ShortenData).short_url).toBe('https://is.gd/abc123');
    expect((result.data as ShortenData).long_url).toBe(LONG);
  });
});

describe('a service that fails says so', () => {
  it('reports a transport error rather than an empty list', async () => {
    mockedAxios.get.mockRejectedValue(new Error('Request failed with status code 502'));
    const result = await provider('is.gd').lookup(LONG, 'shorten');
    expect(result.success).toBe(false);
    expect(result.error).toContain('502');
    expect((result.data as ShortenData).short_links).toBeUndefined();
  });

  it('reports a rate limit rather than succeeding with nothing', async () => {
    mockedAxios.get.mockResolvedValue({
      data: { errorcode: 4, errormessage: 'Rate limit exceeded. Please try again later.' },
    } as never);
    const result = await provider('is.gd').lookup(LONG, 'shorten');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/rate limit/i);
  });

  it('refuses a 200 whose body is not a URL, which these endpoints do return', async () => {
    mockedAxios.get.mockResolvedValue({ data: 'Error: Invalid URL submitted' } as never);
    const result = await provider('tinyurl').lookup(LONG, 'shorten');
    expect(result.success).toBe(false);
    expect(result.error).toContain('no usable short URL');
  });

  it('refuses a query that is not an http(s) URL without making a request', async () => {
    const result = await provider('is.gd').lookup('not a url', 'shorten');
    expect(result.success).toBe(false);
    expect(result.error).toContain('not a URL');
    expect(mockedAxios.get).not.toHaveBeenCalled();

    const ftp = await provider('is.gd').lookup('ftp://example.com/x', 'shorten');
    expect(ftp.success).toBe(false);
    expect(ftp.error).toContain('not an http(s) URL');
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });

  it('percent-encodes the URL into the query string', async () => {
    // axios' own `params` serializer leaves `:` and `/` raw, and TinyURL answers
    // 400 to every request built that way — found by the live probe, pinned here.
    mockedAxios.get.mockResolvedValue({ data: 'https://tinyurl.com/peakb' } as never);
    await provider('tinyurl').lookup('https://example.com/a?b=c&d=e', 'shorten');
    const [requested] = mockedAxios.get.mock.calls[0];
    expect(requested).toContain('url=https%3A%2F%2Fexample.com%2Fa%3Fb%3Dc%26d%3De');
  });

  it('makes exactly one request per lookup — a retry could leave a second link behind', async () => {
    mockedAxios.get.mockRejectedValue(new Error('timeout of 30000ms exceeded'));
    await provider('is.gd').lookup(LONG, 'shorten');
    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
  });
});

describe('YOURLS', () => {
  const SUCCESS = {
    status: 'success',
    shorturl: 'https://s.example.com/abc',
    url: { keyword: 'abc', url: LONG, date: '2026-09-30 12:00:00', clicks: '0' },
  };

  it('is unavailable with no configuration at all', () => {
    expect(yourls.isAvailable()).toBe(false);
  });

  it('is unavailable with a URL but no credentials', () => {
    config.yourlsApiUrl = 'https://s.example.com/yourls-api.php';
    expect(yourls.isAvailable()).toBe(false);
  });

  it('is unavailable with credentials but no URL — there is nothing to call', () => {
    config.yourlsSignature = 'token';
    expect(yourls.isAvailable()).toBe(false);
  });

  it('accepts a username/password pair as the alternative to a signature', () => {
    config.yourlsApiUrl = 'https://s.example.com/yourls-api.php';
    config.yourlsUsername = 'admin';
    expect(yourls.isAvailable()).toBe(false);
    config.yourlsPassword = 'secret';
    expect(yourls.isAvailable()).toBe(true);
  });

  it('posts the credentials in the body, never in the query string', async () => {
    config.yourlsApiUrl = 'https://s.example.com/yourls-api.php';
    config.yourlsSignature = 'token';
    mockedAxios.post.mockResolvedValue({ data: SUCCESS } as never);

    await yourls.lookup(LONG, 'shorten');
    expect(mockedAxios.get).not.toHaveBeenCalled();
    const [url, body] = mockedAxios.post.mock.calls[0];
    expect(url).toBe('https://s.example.com/yourls-api.php');
    expect(String(body)).toContain('signature=token');
    expect(String(body)).toContain('action=shorturl');
  });

  it('reads a created link, with the keyword and an ISO date', async () => {
    config.yourlsApiUrl = 'https://s.example.com/yourls-api.php';
    config.yourlsSignature = 'token';
    mockedAxios.post.mockResolvedValue({ data: SUCCESS } as never);

    const result = await yourls.lookup(LONG, 'shorten');
    const link = (result.data as ShortenData).short_links?.[0];
    expect(result.success).toBe(true);
    expect(link).toMatchObject({
      service: 'yourls',
      short_url: 'https://s.example.com/abc',
      keyword: 'abc',
      clicks: 0,
      existing: false,
    });
    expect(link?.created).toMatch(/^2026-09-30T/);
  });

  it('treats "already exists" as an existing link, not a new one and not a failure', async () => {
    config.yourlsApiUrl = 'https://s.example.com/yourls-api.php';
    config.yourlsSignature = 'token';
    mockedAxios.post.mockResolvedValue({
      data: {
        status: 'fail',
        code: 'error:url',
        message: 'https://example.com/ already exists in database',
        shorturl: 'https://s.example.com/abc',
        url: { keyword: 'abc', url: LONG },
      },
    } as never);

    const result = await yourls.lookup(LONG, 'shorten');
    expect(result.success).toBe(true);
    expect((result.data as ShortenData).short_links?.[0]?.existing).toBe(true);
  });

  it('fails loudly when the instance rejects the signature', async () => {
    config.yourlsApiUrl = 'https://s.example.com/yourls-api.php';
    config.yourlsSignature = 'wrong';
    mockedAxios.post.mockResolvedValue({
      data: {
        status: 'fail',
        code: 'error:auth',
        message: 'Unable to authenticate (bad signature)',
      },
    } as never);

    const result = await yourls.lookup(LONG, 'shorten');
    expect(result.success).toBe(false);
    expect(result.error).toContain('bad signature');
    expect((result.data as ShortenData).short_links).toBeUndefined();
  });

  it('is registered first, so the merged flat short_url is the self-hosted one', () => {
    expect(PROVIDER_NAMES[0]).toBe('yourls');
  });
});
