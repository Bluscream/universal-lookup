/**
 * The `social` lookup: one account in, every linked account out, each one
 * described by its own platform.
 *
 * This is the only lookup type here that runs in two dependent stages, and that
 * shapes everything below. Every other registry fans out to providers that all
 * answer the same question about the same query, so `executeProvidersBackground`
 * can race them and merge. Here the enrichment stage cannot start until the
 * discovery stage has said which accounts exist — asking YouTube about a channel
 * nobody claimed is not a question worth asking.
 *
 * So the pipeline is explicit:
 *
 *   1. Discovery: Keybase, Harbor and Synchra in parallel, each turning the
 *      query into a set of claimed accounts.
 *   2. Merge: the same account claimed by two sources becomes one entry whose
 *      `sources` and `verified_by` are the union, so corroboration is visible
 *      rather than double-counted.
 *   3. Enrichment: for each account, the enricher for its platform, in parallel
 *      and capped, reads what the platform currently says.
 *   4. Group by platform, which is the published shape.
 *
 * The dual-promise contract the route expects is still honoured. `clientPromise`
 * resolves at CLIENT_TIMEOUT with whatever is finished — in practice discovery
 * and some enrichment — while `serverPromise` runs the pipeline to the end and
 * refreshes the cache. A caller who wants the whole thing passes `?wait=true`.
 */

import { config } from '../../config.js';
import { isBlacklisted, type DualPromiseResult, filterProviders } from '../../lib/providers.js';
import type {
  LookupOptions,
  LookupType,
  Provider,
  ProviderResult,
  SocialAccount,
  SocialChatMessage,
} from '../../types/common.js';
import { githubUser } from './enrich/github-user.js';
import { hackernewsUser } from './enrich/hackernews-user.js';
import { redditUser } from './enrich/reddit-user.js';
import { twitchChannel } from './enrich/twitch-channel.js';
import { youtubeChannel } from './enrich/youtube-channel.js';
import { harbor } from './harbor.js';
import { keybase } from './keybase.js';
import {
  canonicalPlatform,
  type DiscoveryData,
  type Enricher,
  groupByPlatform,
  mergeAccounts,
  normalizeHandle,
} from './shared.js';
import { synchra } from './synchra.js';

/**
 * Discovery order is merge priority: where two sources disagree about a field,
 * the earlier one wins. Harbor first because its claims are signed and checked
 * against a pinned verifier; Keybase next, whose proofs are real but frozen;
 * Synchra last, which knows the most about a streamer's own channels but
 * attests nothing cryptographically.
 */
const DISCOVERY: Provider[] = [harbor, keybase, synchra];

/** One enricher per platform. */
const ENRICHERS: Enricher[] = [
  youtubeChannel,
  twitchChannel,
  githubUser,
  redditUser,
  hackernewsUser,
];

/** The aggregator's own name, so an operator can turn the grouping off. */
const AGGREGATOR = 'social-graph';

function enricherFor(platform: string): Enricher | undefined {
  const slug = canonicalPlatform(platform);
  return ENRICHERS.find(
    (enricher) =>
      enricher.platform === slug && enricher.isAvailable() && !isBlacklisted(enricher.name),
  );
}

/**
 * Read every discovered account from its own platform.
 *
 * Bounded by SOCIAL_ENRICH_LIMIT. One identity with forty claims would
 * otherwise mean forty third-party requests for a single lookup, which is both
 * slow and a poor way to treat free APIs. Accounts past the cap keep their
 * claimed fields and are simply not enriched, which is why they still appear.
 *
 * Failures are collected rather than thrown: a YouTube quota error must not cost
 * the caller the GitHub account that was read successfully a moment earlier.
 */
async function enrichAll(
  accounts: SocialAccount[],
): Promise<{ accounts: SocialAccount[]; failures: ProviderResult<DiscoveryData>[] }> {
  const failures: ProviderResult<DiscoveryData>[] = [];
  const budget = accounts.slice(0, config.socialEnrichLimit);

  const enriched = await Promise.all(
    budget.map(async (account) => {
      const enricher = enricherFor(account.platform);
      if (!enricher) return account;
      const start = Date.now();
      try {
        return await enricher.enrich(account);
      } catch (error) {
        failures.push({
          provider: enricher.name,
          success: false,
          data: {},
          error: `${account.platform}/${account.account ?? account.account_id ?? '?'}: ${
            error instanceof Error ? error.message : String(error)
          }`,
          duration: Date.now() - start,
        });
        return account;
      }
    }),
  );

  return { accounts: [...enriched, ...accounts.slice(config.socialEnrichLimit)], failures };
}

/**
 * The whole pipeline, as the list of results the route merges.
 *
 * Discovery results are returned with their `data` blanked. They have already
 * been consumed into the grouped map, and leaving the flat `socials` list in
 * place would publish every account twice under two different shapes. Blanking
 * keeps what the route actually needs from them — the provider name, the
 * success flag and the error — so a dead source is still visible in `errors`.
 */
async function pipeline(
  query: string,
  providers: Provider[],
  type: LookupType,
  options?: LookupOptions,
): Promise<ProviderResult[]> {
  const discoveries = await Promise.all(
    providers.map(async (provider) => {
      try {
        return (await provider.lookup(
          query,
          type,
          query,
          options,
        )) as ProviderResult<DiscoveryData>;
      } catch (error) {
        return {
          provider: provider.name,
          success: false,
          data: {},
          error: error instanceof Error ? error.message : String(error),
          duration: 0,
        } satisfies ProviderResult<DiscoveryData>;
      }
    }),
  );

  const claimed = discoveries.flatMap((result) => result.data.socials ?? []);
  const chat = discoveries.flatMap((result) => result.data.recent_chat ?? []);
  const identities = discoveries
    .filter((result) => result.data.identity !== undefined)
    .map((result) => `${result.provider}:${result.data.identity as string}`);

  const blanked: ProviderResult[] = discoveries.map((result) => ({ ...result, data: {} }));

  if (claimed.length === 0 || isBlacklisted(AGGREGATOR)) {
    return blanked;
  }

  const merged = mergeAccounts(claimed);
  const { accounts, failures } = await enrichAll(merged);

  return [
    ...blanked,
    ...failures.map((failure) => ({ ...failure, data: {} }) as ProviderResult),
    aggregate(accounts, identities, chat, merged.length),
  ];
}

/** The one result that carries the published shape. */
function aggregate(
  accounts: SocialAccount[],
  identities: string[],
  chat: SocialChatMessage[],
  found: number,
): ProviderResult {
  return {
    provider: AGGREGATOR,
    success: found > 0,
    data: {
      accounts: groupByPlatform(accounts),
      identities,
      recent_chat: chat.length > 0 ? chat : undefined,
    },
    duration: 0,
  };
}

export function lookupSocial(
  query: string,
  type: LookupType = 'social',
  originalQuery?: string,
  options?: LookupOptions,
): DualPromiseResult {
  const providers = filterProviders(DISCOVERY, type);
  const handle = normalizeHandle(originalQuery ?? query);

  // One shared run, observed twice. The stages are dependent, so there is no
  // useful partial result to assemble at the client deadline beyond "not
  // finished yet" — but the run continues either way and the cache is updated
  // from it, which is the point of the dual promise.
  const run = pipeline(handle, providers, type, options);

  let timer: ReturnType<typeof setTimeout> | undefined;
  const clientPromise = Promise.race([
    run,
    new Promise<ProviderResult[]>((resolve) => {
      timer = setTimeout(
        () =>
          resolve([
            {
              provider: AGGREGATOR,
              success: false,
              data: {},
              error: 'Timeout (Background processing)',
              duration: config.clientTimeout,
            },
          ]),
        config.clientTimeout,
      );
    }),
    // Losing the race must not leave the timer holding the event loop open —
    // the same leak that made this process slow to exit on SIGTERM.
  ]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });

  return { clientPromise, serverPromise: run };
}

/** Every provider registered for this lookup type, in registry order. */
export const PROVIDERS: Provider[] = [...DISCOVERY, ...ENRICHERS];

/** Names of every provider registered for this lookup type. */
export const PROVIDER_NAMES: string[] = [...PROVIDERS.map((p) => p.name), AGGREGATOR];
