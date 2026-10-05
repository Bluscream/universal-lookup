/**
 * Shared plumbing for the `social` lookup.
 *
 * The lookup runs in two stages and this file holds what both of them need. The
 * discovery stage asks identity services "who else is this person?" and the
 * enrichment stage asks each named platform "what is this account like?". They
 * fail in different ways and must report differently: a discovery source that
 * knows nothing about the query has given a real answer, while an enricher that
 * cannot reach YouTube has not.
 *
 * The one rule everything here exists to enforce: a claimed link and a verified
 * link are never flattened into each other. `mergeAccounts` keeps `sources` and
 * `verified_by` as unions, so an account vouched for by Harbor's verifier and
 * also merely mentioned by Keybase still shows both facts.
 */

import axios, { type AxiosRequestConfig } from 'axios';
import { config } from '../../config.js';
import type {
  Provider,
  ProviderResult,
  SocialAccount,
  SocialChatMessage,
} from '../../types/common.js';

/** Sent on every request: Reddit and Hacker News both throttle an unnamed client. */
export const USER_AGENT =
  'Mozilla/5.0 (compatible; universal-lookup/1.0; +https://github.com/Bluscream/universal-lookup)';

/**
 * Platform slugs, canonicalised.
 *
 * Harbor, Keybase and Synchra each spell the same platform differently —
 * Keybase says `twitter` and `hackernews`, Harbor says `x` and `hacker-news`,
 * Synchra says `x`. Grouping by platform only works if they agree, so every
 * source's name is mapped through here on the way in. Anything unmapped passes
 * through lowercased, so a platform none of them had yet still groups sanely
 * instead of being dropped.
 */
const PLATFORM_ALIASES: Record<string, string> = {
  twitter: 'x',
  'hacker-news': 'hackernews',
  hacker_news: 'hackernews',
  news: 'hackernews',
  generic_web_site: 'website',
  web: 'website',
  dns: 'website',
  domain: 'website',
  github_org: 'github',
  'youtube-channel': 'youtube',
};

export function canonicalPlatform(platform: string): string {
  const slug = platform.trim().toLowerCase().replace(/\s+/g, '-');
  return PLATFORM_ALIASES[slug] ?? slug;
}

/**
 * The query, as a bare handle.
 *
 * Users paste `@bleichi_loveless`, a profile URL, or the handle alone, and every
 * source here wants the handle alone. A URL is reduced to its last meaningful
 * path segment, which is where every platform in scope puts the handle —
 * `/user/x`, `/c/x`, `/@x`, `/in/x` all end in it.
 */
export function normalizeHandle(query: string): string {
  let text = query.trim();
  if (/^https?:\/\//i.test(text)) {
    try {
      const url = new URL(text);
      const segments = url.pathname.split('/').filter((s) => s !== '');
      text = segments.at(-1) ?? url.hostname;
    } catch {
      // Not parseable as a URL after all; fall through and treat it as a handle.
    }
  }
  return text.replace(/^@+/, '').trim();
}

/** Whether a query looks like a platform's numeric or opaque id rather than a handle. */
export function looksLikeId(query: string): boolean {
  return /^(UC[\w-]{20,}|\d{5,})$/.test(query.trim());
}

/**
 * Turn any thrown value into a sentence that says what actually went wrong.
 *
 * The live probe classifies a row as broken by matching the error text, so the
 * HTTP status has to survive into the message — a bare "Request failed" reads as
 * an empty answer and hides a dead endpoint or an expired key.
 */
export function describeError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    if (status !== undefined) {
      return `${error.config?.url ?? 'request'} returned status code ${status}`;
    }
    if (error.code) return `${error.code}: ${error.message}`;
  }
  return error instanceof Error ? error.message : String(error);
}

/**
 * What a discovery provider hands to the aggregator.
 *
 * Deliberately not `SocialData`: this is the intermediate, flat form — one
 * source's findings, before they are merged across sources and grouped by
 * platform. The aggregator blanks it once consumed, so it never reaches the
 * published response and `SocialData` stays the only shape a client sees.
 */
export interface DiscoveryData {
  socials?: SocialAccount[];
  /** The identity this source resolved the query to, in its own namespace. */
  identity?: string;
  /**
   * Recent chat, which only Synchra can supply. It passes through the
   * aggregator untouched — unlike accounts there is nothing to merge, since no
   * other source holds any.
   */
  recent_chat?: SocialChatMessage[];
  [key: string]: unknown;
}

/** A failed ProviderResult that names its cause. */
export function failure(
  provider: string,
  start: number,
  error: unknown,
): ProviderResult<DiscoveryData> {
  return {
    provider,
    success: false,
    data: {},
    error: describeError(error),
    duration: Date.now() - start,
  };
}

/**
 * A discovery provider's result.
 *
 * An empty list is a real answer here — most people are not on Keybase, and
 * "this source has never heard of them" is information, not a malfunction. It is
 * reported as an unsuccessful result with a plain message so it lands in
 * `errors` as an explanation rather than being silently indistinguishable from a
 * timeout.
 */
export function discovered(
  provider: string,
  start: number,
  query: string,
  accounts: SocialAccount[],
  identity?: string,
  raw?: unknown,
): ProviderResult<DiscoveryData> {
  if (accounts.length === 0) {
    return {
      provider,
      success: false,
      data: {},
      raw,
      error: `No identity matching "${query}"`,
      duration: Date.now() - start,
    };
  }
  return {
    provider,
    success: true,
    data: { socials: accounts, identity },
    raw,
    duration: Date.now() - start,
  };
}

/**
 * Catch a 200 that is not the document we asked for.
 *
 * `old.reddit.com` answers a `.json` endpoint with an HTML interstitial — status
 * 200, `text/html` — for clients it does not like. axios hands that back as a
 * string, every field reads as undefined, and the enricher would report "no such
 * account" for what was actually a block. A wrong content type is a failure and
 * has to be named as one.
 */
function assertNotAnInterstitial(url: string, data: unknown): void {
  if (typeof data !== 'string') return;
  if (!data.trimStart().startsWith('<')) return;
  throw new Error(`${url} returned an HTML page instead of JSON — blocked or rate-limited?`);
}

/** GET with the shared timeout and user agent. */
export async function get<T>(url: string, options?: AxiosRequestConfig): Promise<T> {
  const response = await axios.get<T>(url, {
    timeout: config.serverTimeout,
    headers: { 'User-Agent': USER_AGENT, ...options?.headers },
    ...options,
  });
  assertNotAnInterstitial(url, response.data);
  return response.data;
}

/**
 * A GET that treats 404 as "no such account" rather than as a broken endpoint.
 *
 * Every platform read here uses 404 for a handle that does not exist, which is a
 * miss. Everything else still throws so a 403 or a 500 cannot masquerade as an
 * empty profile.
 */
export async function getAllowing404<T>(
  url: string,
  options?: AxiosRequestConfig,
): Promise<T | null> {
  try {
    return await get<T>(url, options);
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 404) return null;
    throw error;
  }
}

function union(...lists: Array<string[] | null | undefined>): string[] {
  return [...new Set(lists.flatMap((list) => list ?? []))];
}

function idOf(account: SocialAccount): string | undefined {
  return account.account_id?.trim().toLowerCase() || undefined;
}

function handleOf(account: SocialAccount): string | undefined {
  return account.account?.trim().toLowerCase().replace(/^@+/, '') || undefined;
}

/**
 * Whether two claims are about the same account.
 *
 * Keying on one field does not work, and that is the whole difficulty here.
 * Keybase records no platform ids at all, so its claims carry only a handle;
 * Harbor's YouTube claims carry both. Matching on id alone leaves the same
 * channel listed twice, once per source — which is the bug this replaced.
 *
 * So: ids decide when both sides have one, because an id is the platform's own
 * answer and two different ids are two different accounts even if the handle
 * matches today. Handles decide only when at least one side has no id, which is
 * exactly the Keybase-meets-Harbor case.
 */
function sameAccount(a: SocialAccount, b: SocialAccount): boolean {
  if (canonicalPlatform(a.platform) !== canonicalPlatform(b.platform)) return false;

  const [idA, idB] = [idOf(a), idOf(b)];
  if (idA !== undefined && idB !== undefined) return idA === idB;

  const [handleA, handleB] = [handleOf(a), handleOf(b)];
  return handleA !== undefined && handleA === handleB;
}

/**
 * Collapse the same account claimed by several sources into one entry.
 *
 * Keybase and Harbor overlap on GitHub and X, and a person's own Synchra channel
 * repeats what Harbor already said. Reporting each twice would make an account
 * look twice as corroborated as it is, so they fold together — but `sources` and
 * `verified_by` become the union, which is what actually says how well attested
 * the link is. Field values keep the first non-empty one, and sources are passed
 * in priority order.
 */
export function mergeAccounts(accounts: SocialAccount[]): SocialAccount[] {
  const merged: SocialAccount[] = [];

  for (const raw of accounts) {
    const account: SocialAccount = { ...raw, platform: canonicalPlatform(raw.platform) };
    const at = merged.findIndex((existing) => sameAccount(existing, account));
    if (at === -1) {
      merged.push(account);
      continue;
    }

    const existing = merged[at] as SocialAccount;
    merged[at] = {
      ...account,
      ...existing,
      // An id or url learned from the later source is worth keeping — it is
      // often the only thing that knows a YouTube channel's UC… id.
      account: existing.account ?? account.account,
      account_id: existing.account_id ?? account.account_id,
      url: existing.url ?? account.url,
      sources: union(existing.sources, account.sources),
      verified_by: union(existing.verified_by, account.verified_by),
    };
  }

  return merged;
}

/**
 * A platform reader: given an account someone claimed, what the platform says
 * about it now.
 *
 * It extends `Provider` rather than being a separate concept so that two things
 * come for free — `PROVIDERS_BLACKLIST` can turn one off by name, and the live
 * probe can exercise it like anything else. `lookup()` is that façade, taking a
 * bare handle; the aggregator calls `enrich()` instead, because by then it has
 * an account with an id and a URL worth passing along.
 */
export interface Enricher extends Provider {
  /** The canonical platform slug this reads. One enricher per platform. */
  platform: string;
  enrich(account: SocialAccount): Promise<SocialAccount>;
  /**
   * Fuzzy search for a handle, when the platform offers one.
   *
   * Absent on platforms that do not: Reddit's user search needs scopes an app
   * token does not carry, and Hacker News has no search over users at all. The
   * fallback chain skips a platform that cannot answer rather than guessing.
   */
  search?(handle: string): Promise<SocialAccount[]>;
}

/**
 * How an account came to be in the answer.
 *
 * The first three mean a source asserted the link. The last two do not: they
 * mean this lookup went to a platform and found *a* handle, which is a weaker
 * claim and must be readable as such. Recorded under `metrics.match` rather
 * than in `verified_by`, which is reserved for someone who actually vouched.
 */
export const MATCH_CLAIMED = 'claimed';
export const MATCH_EXACT_HANDLE = 'exact-handle';
export const MATCH_SEARCH = 'search-result';

/**
 * Build an enricher from the one function that differs between platforms.
 *
 * `read` returns only the fields it learned, and a miss returns null — a handle
 * that 404s is a claim that has gone stale, which is worth reporting as such
 * rather than as a failed request. Everything else — merging onto the claimed
 * account, stamping `enriched_by`, timing, error shape — is identical across
 * platforms and lives here.
 */
export function defineEnricher(spec: {
  name: string;
  platform: string;
  isAvailable: () => boolean;
  read: (account: SocialAccount) => Promise<Partial<SocialAccount> | null>;
  /**
   * Candidates whose handle resembles the query, best first.
   *
   * Each returns only the fields the search itself produced; the platform,
   * provenance and match label are stamped on below so every enricher labels a
   * search hit identically.
   */
  findByName?: (handle: string) => Promise<Partial<SocialAccount>[]>;
}): Enricher {
  async function enrich(account: SocialAccount): Promise<SocialAccount> {
    const learned = await spec.read(account);
    if (!learned) return account;
    // `metrics` merges rather than replacing. A flat spread would drop whatever
    // the discovery stage recorded there — including `match`, which says on
    // what basis the account is in the answer at all, and which would then go
    // missing from precisely the accounts a platform confirmed.
    return {
      ...account,
      ...learned,
      metrics:
        account.metrics || learned.metrics
          ? { ...(account.metrics ?? {}), ...(learned.metrics ?? {}) }
          : undefined,
      enriched_by: spec.name,
    };
  }

  const findByName = spec.findByName;
  const search = findByName
    ? async (handle: string): Promise<SocialAccount[]> =>
        (await findByName(normalizeHandle(handle))).map((found) => ({
          account: null,
          ...found,
          platform: spec.platform,
          sources: [spec.name],
          // Nobody vouched for this: the handle merely looked right.
          verified_by: [],
          enriched_by: spec.name,
          metrics: { ...(found.metrics ?? {}), match: MATCH_SEARCH },
        }))
    : undefined;

  return {
    name: spec.name,
    platform: spec.platform,
    enrich,
    ...(search ? { search } : {}),
    isAvailable: spec.isAvailable,
    async lookup(query: string): Promise<ProviderResult<DiscoveryData>> {
      const start = Date.now();
      const handle = normalizeHandle(query);
      try {
        const account = await enrich({
          platform: spec.platform,
          account: handle,
          sources: [spec.name],
        });
        return account.enriched_by === spec.name
          ? {
              provider: spec.name,
              success: true,
              data: { socials: [account] },
              duration: Date.now() - start,
            }
          : {
              provider: spec.name,
              success: false,
              data: {},
              error: `No ${spec.platform} account named "${handle}"`,
              duration: Date.now() - start,
            };
      } catch (error) {
        return failure(spec.name, start, error);
      }
    },
  };
}

/** Group merged accounts by platform, each platform's list in discovery order. */
export function groupByPlatform(accounts: SocialAccount[]): Record<string, SocialAccount[]> {
  const grouped: Record<string, SocialAccount[]> = {};
  for (const account of accounts) {
    const platform = canonicalPlatform(account.platform);
    grouped[platform] = [...(grouped[platform] ?? []), account];
  }
  return grouped;
}
