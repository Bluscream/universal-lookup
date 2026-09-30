import type {
  LookupType,
  Provider,
  ProviderResult,
  ShortenData,
  ShortLink,
} from '../../types/common.js';

/**
 * Shortening is a write.
 *
 * Every provider in this registry creates a real, permanent record on somebody
 * else's server, which makes it unlike every other lookup type here. Three rules
 * follow from that and are enforced in this file rather than left to each
 * provider to remember:
 *
 *  - One request per provider per lookup. No retry loop: a retry after a
 *    timeout can leave a second link behind for a request that actually
 *    succeeded, and there is no way to tell from the outside.
 *  - Nothing else may fan out to it. `shorten` is not a fallback for any other
 *    type and has no detectType rule, so it only ever runs when it was asked
 *    for by name.
 *  - A failure says what happened. An empty short_links list that reads like an
 *    answer would be worse here than anywhere else, because the caller's next
 *    move is to publish the link.
 */

/** The URL a provider is willing to shorten, or an explanation of why not. */
export function validateTarget(query: string): { url: string } | { error: string } {
  let parsed: URL;
  try {
    parsed = new URL(query.trim());
  } catch {
    return { error: `not a URL: ${query}` };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { error: `not an http(s) URL: ${parsed.protocol}//…` };
  }
  return { url: parsed.toString() };
}

/** The successful shape, with the link duplicated into the flat canonical field. */
export function shortened(
  provider: string,
  link: ShortLink,
  raw: unknown,
  start: number,
): ProviderResult<ShortenData> {
  return {
    provider,
    success: true,
    data: { long_url: link.long_url ?? null, short_url: link.short_url, short_links: [link] },
    raw,
    duration: Date.now() - start,
  };
}

/** The failing shape. `error` is always populated — that is the point of it. */
export function failed(
  provider: string,
  error: string,
  start: number,
  raw?: unknown,
): ProviderResult<ShortenData> {
  return { provider, success: false, data: {}, raw, error, duration: Date.now() - start };
}

/** What a single shortening service has to supply: one request, one link. */
export interface Shortener {
  name: string;
  /** False when the service is not configured; open services are always true. */
  available?: () => boolean;
  /**
   * Create (or fetch) the short link for `url`. Returning a string is the
   * failure path and that string becomes the provider's `error`; throwing is
   * also a failure and the thrown message is used, so a transport error reads
   * as one. Never resolve to a link that was not actually created.
   */
  create: (
    url: string,
  ) => Promise<{ link: ShortLink; raw: unknown } | { error: string; raw?: unknown }>;
}

/** Wrap a service as a Provider, with the shared validation and error handling. */
export function asProvider(service: Shortener): Provider {
  return {
    name: service.name,
    isAvailable: () => service.available?.() ?? true,

    async lookup(query: string, _type?: LookupType): Promise<ProviderResult<ShortenData>> {
      const start = Date.now();
      const target = validateTarget(query);
      if ('error' in target) return failed(service.name, target.error, start);

      try {
        const result = await service.create(target.url);
        if ('error' in result) return failed(service.name, result.error, start, result.raw);
        return shortened(service.name, result.link, result.raw, start);
      } catch (error) {
        return failed(service.name, error instanceof Error ? error.message : String(error), start);
      }
    },
  };
}
