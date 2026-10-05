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
 *   1. Discovery: a fallback chain — Synchra, then Keybase, then Harbor, each
 *      turning the query into a set of claimed accounts, stopping at the first
 *      one that finds any. When all three come up empty the chain continues
 *      into `direct.ts`: the handle taken literally on each platform, and then
 *      optionally each platform's own search. See SOCIAL_CASCADE for querying
 *      all three at once and merging instead.
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
import { instagramProfile } from './enrich/instagram-profile.js';
import { hackernewsUser } from './enrich/hackernews-user.js';
import { redditUser } from './enrich/reddit-user.js';
import { threadsProfile } from './enrich/threads-profile.js';
import { twitchChannel } from './enrich/twitch-channel.js';
import { youtubeChannel } from './enrich/youtube-channel.js';
import { githubRepos } from './detail/github-repos.js';
import { hackernewsActivity } from './detail/hackernews-activity.js';
import { redditActivity } from './detail/reddit-activity.js';
import { twitchVideos } from './detail/twitch-videos.js';
import { youtubeUploads } from './detail/youtube-uploads.js';
import { exactHandleMatches, searchFallbackEnabled, searchMatches } from './direct.js';
import { harbor } from './harbor.js';
import { keybase } from './keybase.js';
import {
  canonicalPlatform,
  type Detailer,
  type DiscoveryData,
  type Enricher,
  groupByPlatform,
  MATCH_CLAIMED,
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

/**
 * Fallback order, which is a different question from merge priority.
 *
 * Merging asks "whose field wins"; the chain asks "who is worth asking first",
 * and the answer there is whoever is most likely to know and cheapest to ask.
 * Synchra leads because this deployment's own channels live there and it is the
 * only source that also returns chat; Keybase next, free and unauthenticated;
 * Harbor last of the three. The platforms themselves come after all of them,
 * in `direct.ts`, because they answer a weaker question.
 */
const CASCADE: Provider[] = [synchra, keybase, harbor];

/** One enricher per platform. */
const ENRICHERS: Enricher[] = [
  youtubeChannel,
  twitchChannel,
  githubUser,
  redditUser,
  hackernewsUser,
  instagramProfile,
  threadsProfile,
];

/**
 * Sub-providers, run after enrichment on accounts a platform confirmed.
 *
 * A platform may have more than one — GitHub's repositories and Hacker News's
 * submissions answer the same question in different shapes — so this is a list
 * and every detailer whose platform matches gets to run.
 */
const DETAILERS: Detailer[] = [
  youtubeUploads,
  twitchVideos,
  githubRepos,
  redditActivity,
  hackernewsActivity,
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
 * Read everything else the platforms know about the accounts that turned out to
 * be real.
 *
 * Only enriched accounts are passed in, and that restriction is the point. An
 * account nobody confirmed is a claim, and spending three Twitch requests on a
 * claim that may be a dead handle is how a lookup becomes slow for no answer.
 *
 * Each detailer is an independent failure: a YouTube quota error must not cost
 * the caller the GitHub repositories that were read a moment earlier, so
 * failures are collected and reported per sub-provider, exactly as enrichment
 * does. The work is bounded twice over — by how many accounts get here, and by
 * SOCIAL_DETAIL_LIMIT items per sub-provider.
 */
async function detailAll(
  accounts: SocialAccount[],
): Promise<{ accounts: SocialAccount[]; failures: ProviderResult<DiscoveryData>[] }> {
  const failures: ProviderResult<DiscoveryData>[] = [];

  const detailed = await Promise.all(
    accounts.map(async (account) => {
      // An account no enricher confirmed has nothing worth asking about, and
      // the detailers address platforms by the ids enrichment resolves.
      if (!account.enriched_by) return account;

      const slug = canonicalPlatform(account.platform);
      const applicable = DETAILERS.filter(
        (detailer) =>
          detailer.platform === slug && detailer.isAvailable() && !isBlacklisted(detailer.name),
      );
      if (applicable.length === 0) return account;

      const results = await Promise.all(
        applicable.map(async (detailer) => {
          const start = Date.now();
          try {
            return { detailer, learned: await detailer.detail(account, config.socialDetailLimit) };
          } catch (error) {
            failures.push({
              provider: detailer.name,
              success: false,
              data: {},
              error: `${account.platform}/${account.account ?? account.account_id ?? '?'}: ${
                error instanceof Error ? error.message : String(error)
              }`,
              duration: Date.now() - start,
            });
            return null;
          }
        }),
      );

      const landed = results.filter(
        (result): result is NonNullable<typeof result> => result !== null,
      );
      if (landed.length === 0) return account;

      const activity = landed.flatMap(({ learned }) => learned.activity ?? []);
      // Newest first across every sub-provider, so a channel's videos and its
      // clips read as one timeline rather than two concatenated lists.
      activity.sort((a, b) => Date.parse(b.time ?? '') - Date.parse(a.time ?? ''));

      const details: Record<string, unknown> = {};
      for (const { detailer, learned } of landed) {
        if (learned.details) details[detailer.name] = learned.details;
      }

      return {
        ...account,
        activity: activity.length > 0 ? activity : null,
        details: Object.keys(details).length > 0 ? details : null,
        detailed_by: landed.map(({ detailer }) => detailer.name),
      } satisfies SocialAccount;
    }),
  );

  return { accounts: detailed, failures };
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
async function ask(
  provider: Provider,
  query: string,
  type: LookupType,
  options?: LookupOptions,
): Promise<ProviderResult<DiscoveryData>> {
  try {
    return (await provider.lookup(query, type, query, options)) as ProviderResult<DiscoveryData>;
  } catch (error) {
    return {
      provider: provider.name,
      success: false,
      data: {},
      error: error instanceof Error ? error.message : String(error),
      duration: 0,
    } satisfies ProviderResult<DiscoveryData>;
  }
}

/**
 * Stages 1–3, as a chain or as a fan-out.
 *
 * The chain is the default and what SOCIAL_CASCADE describes: ask one source,
 * and move on only if it found nothing. It is one request instead of three for
 * a handle the first source knows, and it is the behaviour an operator asked
 * for — but it genuinely returns less, because sources overlap only partly and
 * a source that is never asked cannot contribute. SOCIAL_CASCADE=false asks all
 * three at once and merges, which is the broader, slower answer.
 *
 * A source that *errors* does not end the chain. "Keybase is down" is not
 * "Keybase says no", and treating the two alike would silently truncate the
 * answer whenever a free API had a bad minute.
 */
async function discover(
  query: string,
  providers: Provider[],
  type: LookupType,
  options?: LookupOptions,
): Promise<ProviderResult<DiscoveryData>[]> {
  if (!config.socialCascade) {
    return Promise.all(providers.map((provider) => ask(provider, query, type, options)));
  }

  const ordered = CASCADE.filter((provider) => providers.includes(provider));
  const results: ProviderResult<DiscoveryData>[] = [];
  for (const provider of ordered) {
    const result = await ask(provider, query, type, options);
    results.push(result);
    if ((result.data.socials ?? []).length > 0) break;
  }
  return results;
}

async function pipeline(
  query: string,
  providers: Provider[],
  type: LookupType,
  options?: LookupOptions,
): Promise<ProviderResult[]> {
  const discoveries = await discover(query, providers, type, options);
  const direct: ProviderResult<DiscoveryData>[] = [];

  let claimed = discoveries.flatMap((result) => result.data.socials ?? []);
  const fromDirect = claimed.length === 0;

  // Stages 4 and 5 run only when the sources that actually know about links
  // have all come up empty — they are a fallback, not an addition.
  if (claimed.length > 0) {
    claimed = claimed.map((account) => ({
      ...account,
      metrics: { ...(account.metrics ?? {}), match: MATCH_CLAIMED },
    }));
  } else {
    const exact = await exactHandleMatches(ENRICHERS, query);
    direct.push(...exact.failures);
    claimed = exact.accounts;

    if (claimed.length === 0 && searchFallbackEnabled()) {
      const searched = await searchMatches(ENRICHERS, query);
      direct.push(...searched.failures);
      claimed = searched.accounts;
    }
  }

  const chat = discoveries.flatMap((result) => result.data.recent_chat ?? []);
  const identities = discoveries
    .filter((result) => result.data.identity !== undefined)
    .map((result) => `${result.provider}:${result.data.identity as string}`);

  const blanked: ProviderResult[] = [...discoveries, ...direct].map((result) => ({
    ...result,
    data: {},
  }));

  if (claimed.length === 0 || isBlacklisted(AGGREGATOR)) {
    return blanked;
  }

  const merged = mergeAccounts(claimed);
  // Stages 4 and 5 read the platform to decide whether the account exists at
  // all, so their results arrive enriched. Running enrichment over them again
  // would repeat every one of those requests to learn nothing.
  const { accounts: enriched, failures } = fromDirect
    ? { accounts: merged, failures: [] as ProviderResult<DiscoveryData>[] }
    : await enrichAll(merged);

  // The sub-provider stage. Off by default for the same reason it is a separate
  // stage at all: it multiplies the request count, and a caller who wants to
  // know which accounts exist does not necessarily want everything they posted.
  const { accounts, failures: detailFailures } = config.socialDetails
    ? await detailAll(enriched)
    : { accounts: enriched, failures: [] as ProviderResult<DiscoveryData>[] };

  return [
    ...blanked,
    ...[...failures, ...detailFailures].map(
      (failure) => ({ ...failure, data: {} }) as ProviderResult,
    ),
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
export const PROVIDERS: Provider[] = [...DISCOVERY, ...ENRICHERS, ...DETAILERS];

/** Names of every provider registered for this lookup type. */
export const PROVIDER_NAMES: string[] = [...PROVIDERS.map((p) => p.name), AGGREGATOR];
