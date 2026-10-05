import { afterEach, describe, expect, it, vi } from 'vitest';
import { config } from '../backend/src/config.js';
import { profileUrl } from '../backend/src/providers/social/profile-url.js';
import {
  exactHandleMatches,
  searchFallbackEnabled,
  searchMatches,
} from '../backend/src/providers/social/direct.js';
import { PROVIDER_NAMES, PROVIDERS } from '../backend/src/providers/social/index.js';
import {
  claims,
  resolveChannelId as resolveChannelIdForTest,
} from '../backend/src/providers/social/synchra.js';
import { durationSeconds } from '../backend/src/providers/social/detail/youtube-uploads.js';
import {
  canonicalPlatform,
  defineDetailer,
  defineEnricher,
  groupByPlatform,
  looksLikeId,
  mergeAccounts,
  normalizeHandle,
} from '../backend/src/providers/social/shared.js';
import type { SocialAccount } from '../backend/src/types/common.js';

function account(partial: Partial<SocialAccount> & { platform: string }): SocialAccount {
  return { sources: ['test'], ...partial };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the query', () => {
  it('strips the @ the user pasted', () => {
    expect(normalizeHandle('@bleichi_loveless')).toBe('bleichi_loveless');
    expect(normalizeHandle('  @@bleichi_loveless  ')).toBe('bleichi_loveless');
  });

  it('leaves a bare handle alone', () => {
    expect(normalizeHandle('bleichi_loveless')).toBe('bleichi_loveless');
  });

  it('reduces a pasted profile URL to the handle', () => {
    expect(normalizeHandle('https://x.com/shadowstorm_96')).toBe('shadowstorm_96');
    expect(normalizeHandle('https://reddit.com/user/maxtaco')).toBe('maxtaco');
    expect(normalizeHandle('https://www.youtube.com/@asphaltstorm96')).toBe('asphaltstorm96');
    expect(normalizeHandle('https://github.com/Bluscream/')).toBe('Bluscream');
  });

  it('falls back to the host for a URL with no path', () => {
    expect(normalizeHandle('https://example.com')).toBe('example.com');
  });

  it('tells a channel id and a numeric id from a handle', () => {
    expect(looksLikeId('UC1-QO9dEJxK05SAEM02bxkQ')).toBe(true);
    expect(looksLikeId('76561197960435530')).toBe(true);
    expect(looksLikeId('bleichi_loveless')).toBe(false);
    // Short digit strings are handles — plenty of people are called "1234".
    expect(looksLikeId('1234')).toBe(false);
  });
});

describe('platform slugs', () => {
  it('reconciles what the three sources each call the same platform', () => {
    // Keybase says twitter/hackernews, Harbor says x/hacker-news. Grouping only
    // works if they land on one key.
    expect(canonicalPlatform('twitter')).toBe('x');
    expect(canonicalPlatform('x')).toBe('x');
    expect(canonicalPlatform('hackernews')).toBe('hackernews');
    expect(canonicalPlatform('hacker-news')).toBe('hackernews');
    expect(canonicalPlatform('generic_web_site')).toBe('website');
  });

  it('passes an unknown platform through rather than dropping it', () => {
    expect(canonicalPlatform('Bluesky')).toBe('bluesky');
    expect(canonicalPlatform('some new site')).toBe('some-new-site');
  });
});

describe('merging what several sources claimed', () => {
  it('folds one account claimed twice into a single entry', () => {
    const merged = mergeAccounts([
      account({ platform: 'github', account: 'maxtaco', sources: ['harbor'] }),
      account({ platform: 'github', account: 'MaxTaco', sources: ['keybase'] }),
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0]?.sources).toEqual(['harbor', 'keybase']);
  });

  it('unions the verifiers rather than letting the first source answer for both', () => {
    // This is the whole point: corroboration has to be visible, and an
    // unvouched claim must not inherit the trust of the one it merged with.
    const merged = mergeAccounts([
      account({ platform: 'x', account: 'a', sources: ['harbor'], verified_by: ['harbor-verif'] }),
      account({ platform: 'x', account: 'a', sources: ['keybase'], verified_by: ['keybase'] }),
    ]);

    expect(merged[0]?.verified_by).toEqual(['harbor-verif', 'keybase']);
  });

  it('keeps an account_id learned from the second source', () => {
    // Keybase records no platform ids at all, so a Harbor claim is often the
    // only thing that knows a YouTube channel's UC… id.
    const merged = mergeAccounts([
      account({ platform: 'youtube', account: '@a', sources: ['keybase'] }),
      account({ platform: 'youtube', account: '@a', account_id: 'UC123', sources: ['harbor'] }),
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0]?.account_id).toBe('UC123');
  });

  it('treats two accounts with different ids on one platform as different accounts', () => {
    // Two YouTube channels for one person is the case this lookup exists for.
    const merged = mergeAccounts([
      account({ platform: 'youtube', account_id: 'UC111', sources: ['harbor'] }),
      account({ platform: 'youtube', account_id: 'UC222', sources: ['harbor'] }),
    ]);

    expect(merged).toHaveLength(2);
  });

  it('matches across the platform aliases, not just within one spelling', () => {
    const merged = mergeAccounts([
      account({ platform: 'twitter', account: 'dave', sources: ['keybase'] }),
      account({ platform: 'x', account: 'dave', sources: ['harbor'] }),
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0]?.platform).toBe('x');
  });
});

describe('grouping', () => {
  it('gives every platform a list, even when it holds one account', () => {
    const grouped = groupByPlatform([
      account({ platform: 'youtube', account_id: 'UC1' }),
      account({ platform: 'youtube', account_id: 'UC2' }),
      account({ platform: 'github', account: 'a' }),
    ]);

    expect(Object.keys(grouped).sort()).toEqual(['github', 'youtube']);
    expect(grouped.youtube).toHaveLength(2);
    expect(grouped.github).toHaveLength(1);
  });
});

describe('an enricher', () => {
  const stub = (read: () => Promise<Partial<SocialAccount> | null>) =>
    defineEnricher({ name: 'stub', platform: 'github', isAvailable: () => true, read });

  it('merges what the platform said onto the claim and stamps itself', async () => {
    const enricher = stub(() => Promise.resolve({ followers: 42, display_name: 'Max' }));
    const enriched = await enricher.enrich(
      account({ platform: 'github', account: 'maxtaco', sources: ['harbor'] }),
    );

    expect(enriched.followers).toBe(42);
    expect(enriched.enriched_by).toBe('stub');
    // The claim's own fields survive — enrichment adds, it does not replace.
    expect(enriched.sources).toEqual(['harbor']);
  });

  it('returns the claim untouched when the platform has no such account', async () => {
    const enricher = stub(() => Promise.resolve(null));
    const claim = account({ platform: 'github', account: 'gone', sources: ['keybase'] });
    const enriched = await enricher.enrich(claim);

    // A stale claim is still a claim. It is reported, without an enriched_by,
    // which is what says the platform did not confirm it.
    expect(enriched.enriched_by).toBeUndefined();
    expect(enriched.account).toBe('gone');
  });

  it('reports a miss as an unsuccessful lookup rather than an empty success', async () => {
    const enricher = stub(() => Promise.resolve(null));
    const result = await enricher.lookup('gone');

    expect(result.success).toBe(false);
    expect(result.error).toContain('No github account named "gone"');
  });

  it('names the cause when the platform request fails', async () => {
    const enricher = stub(() => Promise.reject(new Error('403 rate limited')));
    const result = await enricher.lookup('maxtaco');

    expect(result.success).toBe(false);
    expect(result.error).toContain('403 rate limited');
  });

  it('lets a failure propagate out of enrich, so the registry can attribute it', async () => {
    const enricher = stub(() => Promise.reject(new Error('boom')));

    await expect(enricher.enrich(account({ platform: 'github', account: 'a' }))).rejects.toThrow(
      'boom',
    );
  });
});

describe('the registry', () => {
  it('registers every discovery source, enricher and sub-provider', () => {
    expect(PROVIDER_NAMES).toEqual([
      'harbor',
      'keybase',
      'synchra',
      'youtube-channel',
      'twitch-channel',
      'github-user',
      'reddit-user',
      'hackernews-user',
      'youtube-uploads',
      'twitch-videos',
      'github-repos',
      'reddit-activity',
      'hackernews-activity',
      'social-graph',
    ]);
  });

  it('names no provider after a platform that already means something else', () => {
    // `github`, `twitch`, `reddit` and `discord` are already taken by the app
    // and status registries, and PROVIDERS_BLACKLIST is one flat namespace — so
    // an enricher called `github` would be disabled by an entry meant for the
    // app lookup's package source. Hence the -user and -channel suffixes.
    const taken = ['github', 'twitch', 'reddit', 'discord', 'youtube'];
    expect(PROVIDER_NAMES.filter((name) => taken.includes(name))).toEqual([]);
  });

  it('declares every discovery source available without credentials', () => {
    // Keybase and Harbor are unauthenticated, and Synchra stays available in
    // order to report "no token" as an answer rather than vanishing.
    for (const name of ['harbor', 'keybase', 'synchra']) {
      const provider = PROVIDERS.find((p) => p.name === name);
      expect(provider?.isAvailable(), name).toBe(true);
    }
  });

  it('gates the enrichers that genuinely need a key, and only those', () => {
    const availability = Object.fromEntries(
      PROVIDERS.filter((p) => p.name.includes('-')).map((p) => [p.name, p.isAvailable()]),
    );

    // These read public endpoints anonymously.
    expect(availability['github-user']).toBe(true);
    expect(availability['hackernews-user']).toBe(true);
    // These three cannot work without credentials, so they must say so instead
    // of failing once per account at request time. Reddit is on this list
    // because it closed its anonymous JSON endpoints, not because it always
    // needed a key.
    expect(availability['youtube-channel']).toBe(Boolean(config.googleApiKey));
    expect(availability['twitch-channel']).toBe(
      Boolean(config.twitchClientId && config.twitchClientSecret),
    );
    expect(availability['reddit-user']).toBe(
      Boolean(config.redditClientId && config.redditClientSecret),
    );
  });
});

describe('merging, the cases that decide id against handle', () => {
  it('keeps two accounts apart when both carry ids and the ids differ', () => {
    // Same handle, different ids: a handle can be reassigned, so the id wins
    // and these stay two accounts.
    const merged = mergeAccounts([
      account({ platform: 'youtube', account: '@a', account_id: 'UC111' }),
      account({ platform: 'youtube', account: '@a', account_id: 'UC222' }),
    ]);

    expect(merged).toHaveLength(2);
  });

  it('matches a handle whether or not it was written with an @', () => {
    const merged = mergeAccounts([
      account({ platform: 'youtube', account: '@asphaltstorm96', sources: ['harbor'] }),
      account({ platform: 'youtube', account: 'asphaltstorm96', sources: ['keybase'] }),
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0]?.sources).toEqual(['harbor', 'keybase']);
  });

  it('does not merge two accounts that share only an empty handle', () => {
    const merged = mergeAccounts([
      account({ platform: 'website', url: 'https://a.example' }),
      account({ platform: 'website', url: 'https://b.example' }),
    ]);

    expect(merged).toHaveLength(2);
  });
});

describe('resolving a Synchra channel', () => {
  /**
   * Three routes, and the safety property that ties them together: a match is
   * published only when something actually identifies the channel.
   *
   * `getChannels` has two filters with very different behaviour, and the
   * difference was nearly fatal. `name` matches server-side but **loosely** —
   * `name=blu` returns the channel displayed as `Bluscream` — so the result is
   * re-checked here for exact equality. `provider_channel_name` on its own is
   * **ignored**, returning every channel the token can see; paired with
   * `provider` it filters exactly. Probed live both ways.
   *
   * So the fakes below come in two flavours: one that honours the filter, like
   * the real API does when both parameters are present, and one that ignores it,
   * like the real API does when they are not.
   */
  const channels = [
    { id: 'aaaaaaaa-0000-0000-0000-000000000001', display_name: 'Bluscream' },
    { id: 'aaaaaaaa-0000-0000-0000-000000000002', display_name: 'feuerfuchs' },
  ];

  /** Ignores every filter, exactly as the API does without `provider`. */
  function ignoresFilters(onParams: (p: Record<string, unknown>) => void = () => {}) {
    return {
      channel: {
        getChannels: (params: Record<string, unknown>) => {
          onParams(params);
          return Promise.resolve({ records: channels });
        },
      },
    };
  }

  /** Honours `provider` + `provider_channel_name`, as the live API does. */
  function honoursFilters(
    handles: Record<string, { provider: string; id: string }>,
    onParams: (p: Record<string, unknown>) => void = () => {},
  ) {
    return {
      channel: {
        getChannels: (params: Record<string, unknown>) => {
          onParams(params);
          const name = params.provider_channel_name as string | undefined;
          if (name === undefined) return Promise.resolve({ records: [] });
          const hit = handles[name];
          return Promise.resolve({
            records: hit && hit.provider === params.provider ? [{ id: hit.id }] : [],
          });
        },
      },
    };
  }

  it('refuses a loose name match instead of attaching the wrong channel', async () => {
    // `blu` is a substring of `Bluscream`, and the API would return it.
    await expect(resolveChannelIdForTest(ignoresFilters(), 'blu')).resolves.toBeNull();
  });

  it('discards a handle match when the filter was plainly not applied', async () => {
    // Two channels back for one handle on one platform means the server
    // ignored the filter, which is the behaviour that used to attach a
    // stranger's accounts and chat to every answer.
    await expect(resolveChannelIdForTest(ignoresFilters(), 'nobody')).resolves.toBeNull();
  });

  it('accepts an exact display name, whatever its case', async () => {
    await expect(resolveChannelIdForTest(ignoresFilters(), 'bluscream')).resolves.toEqual({
      id: 'aaaaaaaa-0000-0000-0000-000000000001',
      route: 'name',
    });
    await expect(resolveChannelIdForTest(ignoresFilters(), 'FEUERFUCHS')).resolves.toEqual({
      id: 'aaaaaaaa-0000-0000-0000-000000000002',
      route: 'name',
    });
  });

  it('finds a channel by a handle on a platform it has connected', async () => {
    // The case the deployed service could not answer: `bleichi_loveless` is a
    // Twitch account name, not a Synchra channel name, and asking by name
    // returns nothing at all.
    const seen: Record<string, unknown>[] = [];
    const match = await resolveChannelIdForTest(
      honoursFilters(
        { bleichi_loveless: { provider: 'twitch', id: 'aaaaaaaa-0000-0000-0000-00000000000b' } },
        (p) => seen.push(p),
      ),
      'bleichi_loveless',
    );

    expect(match).toEqual({ id: 'aaaaaaaa-0000-0000-0000-00000000000b', route: 'provider' });
    // Never `provider_channel_name` alone — that is the form the API ignores.
    for (const params of seen.filter((p) => 'provider_channel_name' in p)) {
      expect(params.provider).toBeDefined();
    }
  });

  it('stops at the platform that answered rather than asking all of them', async () => {
    const seen: Record<string, unknown>[] = [];
    await resolveChannelIdForTest(
      honoursFilters(
        { someone: { provider: 'twitch', id: 'aaaaaaaa-0000-0000-0000-00000000000c' } },
        (p) => seen.push(p),
      ),
      'someone',
    );

    // One name lookup, then Twitch, and no further platforms.
    expect(seen.filter((p) => 'provider' in p).map((p) => p.provider)).toEqual(['twitch']);
  });

  it('takes a uuid without searching at all, since that endpoint needs no token', async () => {
    let searched = false;
    const match = await resolveChannelIdForTest(
      ignoresFilters(() => {
        searched = true;
      }),
      'aaaaaaaa-0000-0000-0000-000000000009',
    );

    expect(match).toEqual({ id: 'aaaaaaaa-0000-0000-0000-000000000009', route: 'uuid' });
    expect(searched).toBe(false);
  });
});

describe('confirming a Synchra handle match', () => {
  it('accepts a channel that carries the handle on one of its accounts', () => {
    expect(claims([{ provider_channel_name: 'bleichi_loveless' }], 'bleichi_loveless')).toBe(true);
    expect(
      claims([{ provider_channel_display_name: 'Bleichi_Loveless' }], 'bleichi_loveless'),
    ).toBe(true);
  });

  it('rejects a channel where nothing carries it', () => {
    // The guard against a filter that was silently ignored: a token able to
    // list exactly one channel would see that channel returned for any query.
    expect(claims([{ provider_channel_name: 'someone_else' }], 'bleichi_loveless')).toBe(false);
    expect(claims([], 'bleichi_loveless')).toBe(false);
  });
});

describe('the fallback chain', () => {
  function enricher(spec: {
    platform: string;
    exists?: boolean;
    searchHit?: string;
    available?: boolean;
  }) {
    return defineEnricher({
      name: `${spec.platform}-test`,
      platform: spec.platform,
      isAvailable: () => spec.available ?? true,
      read: async () => (spec.exists ? { display_name: `${spec.platform} person` } : null),
      ...(spec.searchHit
        ? { findByName: async () => [{ account: spec.searchHit as string }] }
        : {}),
    });
  }

  it('asks a platform for the handle taken literally, and keeps only what exists', async () => {
    const { accounts } = await exactHandleMatches(
      [enricher({ platform: 'github', exists: true }), enricher({ platform: 'twitch' })],
      '@maxtaco',
    );

    expect(accounts.map((a) => a.platform)).toEqual(['github']);
    // An identical handle on another platform is not evidence of the same
    // person, so nothing vouches for it and the weaker basis is recorded.
    expect(accounts[0]?.verified_by).toEqual([]);
    expect(accounts[0]?.metrics?.match).toBe('exact-handle');
  });

  it('reports a platform that failed instead of reading it as a miss', async () => {
    const broken = defineEnricher({
      name: 'broken-test',
      platform: 'github',
      isAvailable: () => true,
      read: async () => {
        throw new Error('503 Service Unavailable');
      },
    });

    const { accounts, failures } = await exactHandleMatches([broken], 'maxtaco');

    expect(accounts).toEqual([]);
    expect(failures[0]?.error).toContain('503');
  });

  it('skips a platform with no search rather than guessing one', async () => {
    const { accounts } = await searchMatches(
      [
        enricher({ platform: 'github', searchHit: 'maxtaco' }),
        // No findByName: Reddit's user search needs scopes an app token lacks.
        enricher({ platform: 'reddit' }),
      ],
      'maxtaco',
    );

    expect(accounts).toHaveLength(1);
    expect(accounts[0]?.platform).toBe('github');
    expect(accounts[0]?.metrics?.match).toBe('search-result');
    expect(accounts[0]?.verified_by).toEqual([]);
  });

  it('takes one hit per platform, not the whole ranked list', async () => {
    const many = defineEnricher({
      name: 'many-test',
      platform: 'github',
      isAvailable: () => true,
      read: async () => null,
      findByName: async () => [{ account: 'first' }, { account: 'second' }],
    });

    const { accounts } = await searchMatches([many], 'first');

    expect(accounts.map((a) => a.account)).toEqual(['first']);
  });

  it('does not reach an unavailable platform', async () => {
    const { accounts } = await exactHandleMatches(
      [enricher({ platform: 'twitch', exists: true, available: false })],
      'x',
    );

    expect(accounts).toEqual([]);
  });

  it('gates the search rung on SOCIAL_DIRECT_SEARCH', () => {
    const original = config.socialDirectSearch;
    try {
      config.socialDirectSearch = false;
      expect(searchFallbackEnabled()).toBe(false);
      config.socialDirectSearch = true;
      expect(searchFallbackEnabled()).toBe(true);
    } finally {
      config.socialDirectSearch = original;
    }
  });
});

describe('enriching an account', () => {
  it('keeps the metrics discovery recorded instead of replacing them', async () => {
    // Regression: a flat spread of `read()`'s result dropped `metrics.match`,
    // so the accounts a platform had confirmed were the ones that lost the
    // record of why they were in the answer.
    const enricher = defineEnricher({
      name: 'merge-test',
      platform: 'github',
      isAvailable: () => true,
      read: async () => ({ followers: 7, metrics: { following: 3 } }),
    });

    const enriched = await enricher.enrich(
      account({ platform: 'github', account: 'x', metrics: { match: 'claimed' } }),
    );

    expect(enriched.metrics).toEqual({ match: 'claimed', following: 3 });
    expect(enriched.followers).toBe(7);
  });

  it('leaves metrics absent when neither side has any', async () => {
    const enricher = defineEnricher({
      name: 'bare-test',
      platform: 'github',
      isAvailable: () => true,
      read: async () => ({ followers: 1 }),
    });

    const enriched = await enricher.enrich(account({ platform: 'github', account: 'x' }));

    expect(enriched.metrics).toBeUndefined();
  });
});

describe("a chat author's profile url", () => {
  it('builds one from the handle for the platforms that use handles', () => {
    expect(profileUrl('twitch', 'bleichi_loveless')).toBe('https://www.twitch.tv/bleichi_loveless');
    expect(profileUrl('tiktok', 'bleichiloveless')).toBe('https://www.tiktok.com/@bleichiloveless');
    expect(profileUrl('x', 'BleichiLoveless')).toBe('https://x.com/BleichiLoveless');
    expect(profileUrl('kick', 'someone')).toBe('https://kick.com/someone');
    expect(profileUrl('rumble', 'someone')).toBe('https://rumble.com/user/someone');
  });

  it('uses the id for YouTube, whose canonical url is the channel id', () => {
    // The handle is what the API gives us for everyone else, but a YouTube
    // viewer url built from a handle is not the one YouTube serves.
    expect(profileUrl('youtube', 'Someone', 'UCabcdefghijklmnopqrstuv')).toBe(
      'https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv',
    );
    // And without an id there is nothing to build, so it says so.
    expect(profileUrl('youtube', 'Someone', null)).toBeNull();
  });

  it('returns null for a platform that has no public profile page', () => {
    // Discord has no public profile url, and these are not places people have
    // profiles at all — a guessed link is worse than no link.
    expect(profileUrl('discord', 'someone', '123')).toBeNull();
    expect(profileUrl('7tv', 'someone')).toBeNull();
    expect(profileUrl('streamelements', 'someone')).toBeNull();
  });

  it('handles a missing platform or handle without inventing a url', () => {
    expect(profileUrl(null, 'someone')).toBeNull();
    expect(profileUrl('twitch', '')).toBeNull();
    expect(profileUrl('twitch', null)).toBeNull();
  });

  it('escapes a handle rather than pasting it into a url', () => {
    expect(profileUrl('twitch', 'a b/c')).toBe('https://www.twitch.tv/a%20b%2Fc');
  });

  it('matches the platform whatever case Synchra reports it in', () => {
    expect(profileUrl('Twitch', 'someone')).toBe('https://www.twitch.tv/someone');
  });
});

describe('a sub-provider', () => {
  function detailer(spec: {
    name?: string;
    platform?: string;
    available?: boolean;
    items?: number;
    throws?: boolean;
    details?: Record<string, unknown>;
  }) {
    return defineDetailer({
      name: spec.name ?? 'test-detail',
      platform: spec.platform ?? 'github',
      isAvailable: () => spec.available ?? true,
      read: async (_account, limit) => {
        if (spec.throws) throw new Error('503 Service Unavailable');
        return {
          activity: Array.from({ length: Math.min(spec.items ?? 2, limit) }, (_, i) => ({
            kind: 'repo',
            // Deliberately wrong, to prove the factory overwrites it.
            source: 'claimed-by-the-detailer',
            id: String(i),
            time: `2026-01-0${i + 1}T00:00:00Z`,
          })),
          details: spec.details,
        };
      },
    });
  }

  it('stamps its own name as the source rather than trusting the entry', async () => {
    const learned = await detailer({ name: 'github-test' }).detail(
      account({ platform: 'github', account: 'x' }),
      5,
    );

    // An entry must always be traceable to whatever fetched it.
    expect(learned.activity?.map((a) => a.source)).toEqual(['github-test', 'github-test']);
  });

  it('honours the per-account item cap', async () => {
    const learned = await detailer({ items: 50 }).detail(
      account({ platform: 'github', account: 'x' }),
      3,
    );

    expect(learned.activity).toHaveLength(3);
  });

  it('is a Provider, so the blacklist and the live probe can reach it', async () => {
    const one = detailer({ name: 'github-test' });

    // The two properties the Enricher comment names as the reason for extending
    // Provider at all: a name to blacklist, and a standalone lookup().
    expect(one.name).toBe('github-test');
    expect(typeof one.lookup).toBe('function');
    expect(typeof one.isAvailable).toBe('function');

    const result = await one.lookup('someone');
    expect(result.provider).toBe('github-test');
    expect(result.success).toBe(true);
    expect(result.data.socials?.[0]?.detailed_by).toEqual(['github-test']);
  });

  it('reports a failure through the standalone façade instead of throwing', async () => {
    const result = await detailer({ throws: true }).lookup('someone');

    expect(result.success).toBe(false);
    expect(result.error).toContain('503');
  });

  it('says so when a platform had nothing recent', async () => {
    const result = await detailer({ items: 0 }).lookup('someone');

    expect(result.success).toBe(false);
    expect(result.error).toContain('Nothing recent');
  });

  it('carries platform-shaped extras separately from the activity list', async () => {
    // A Twitch schedule is a plan, not a published item: sorting it into the
    // timeline would make a future stream indistinguishable from a past one.
    const learned = await detailer({ details: { schedule: [{ title: 'Friday' }] } }).detail(
      account({ platform: 'twitch', account: 'x' }),
      5,
    );

    expect(learned.details).toEqual({ schedule: [{ title: 'Friday' }] });
  });
});

describe('a YouTube duration', () => {
  it('reads an ISO 8601 period as seconds', () => {
    expect(durationSeconds('PT1H2M3S')).toBe(3723);
    expect(durationSeconds('PT45S')).toBe(45);
    expect(durationSeconds('PT12M')).toBe(720);
    // A livestream VOD can run past a day.
    expect(durationSeconds('P1DT2H')).toBe(93600);
  });

  it('returns null rather than zero for something it cannot read', () => {
    // Zero would be a duration, and a video is never zero seconds long.
    expect(durationSeconds(null)).toBeNull();
    expect(durationSeconds('')).toBeNull();
    expect(durationSeconds('banana')).toBeNull();
  });
});
