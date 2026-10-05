import { afterEach, describe, expect, it, vi } from 'vitest';
import { config } from '../backend/src/config.js';
import { PROVIDER_NAMES, PROVIDERS } from '../backend/src/providers/social/index.js';
import { resolveChannelId as resolveChannelIdForTest } from '../backend/src/providers/social/synchra.js';
import {
  canonicalPlatform,
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
  it('registers every discovery source and enricher', () => {
    expect(PROVIDER_NAMES).toEqual([
      'harbor',
      'keybase',
      'synchra',
      'youtube-channel',
      'twitch-channel',
      'github-user',
      'reddit-user',
      'hackernews-user',
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
   * Regression. `getChannels` accepts a `provider_channel_name` parameter and
   * ignores it: probed against the live API with a value no channel could
   * match, it returned every channel the token can see. Reading `records[0]`
   * from that attached an arbitrary unrelated person's channels and chat to the
   * answer, for any query at all.
   *
   * The `name` match is server-side but loose in the same spirit — `name=blu`
   * returns the channel displayed as `Bluscream` — so an exact, case-insensitive
   * check on `display_name` is what actually identifies a channel.
   */
  const channels = [
    { id: 'aaaaaaaa-0000-0000-0000-000000000001', display_name: 'Bluscream' },
    { id: 'aaaaaaaa-0000-0000-0000-000000000002', display_name: 'feuerfuchs' },
  ];

  function fakeSynchra(onParams: (p: Record<string, unknown>) => void) {
    return {
      channel: {
        getChannels: (params: Record<string, unknown>) => {
          onParams(params);
          // Deliberately ignores the filter, exactly as the real API does.
          return Promise.resolve({ records: channels });
        },
      },
      channelProvider: { getChannelProviders: () => Promise.resolve([]) },
      chat: { getChatMessages: () => Promise.resolve({ records: [] }) },
    };
  }

  it('refuses a loose match instead of attaching the wrong channel', async () => {
    const seen: Record<string, unknown>[] = [];
    const id = await resolveChannelIdForTest(
      fakeSynchra((p) => seen.push(p)),
      'blu',
    );

    expect(id).toBeNull();
    // And it must not have fallen back to the parameter the API ignores.
    expect(seen.some((p) => 'provider_channel_name' in p)).toBe(false);
  });

  it('accepts an exact display name, whatever its case', async () => {
    await expect(
      resolveChannelIdForTest(
        fakeSynchra(() => {}),
        'bluscream',
      ),
    ).resolves.toBe('aaaaaaaa-0000-0000-0000-000000000001');
    await expect(
      resolveChannelIdForTest(
        fakeSynchra(() => {}),
        'FEUERFUCHS',
      ),
    ).resolves.toBe('aaaaaaaa-0000-0000-0000-000000000002');
  });

  it('takes a uuid without searching at all, since that endpoint needs no token', async () => {
    let searched = false;
    const id = await resolveChannelIdForTest(
      fakeSynchra(() => {
        searched = true;
      }),
      'aaaaaaaa-0000-0000-0000-000000000009',
    );

    expect(id).toBe('aaaaaaaa-0000-0000-0000-000000000009');
    expect(searched).toBe(false);
  });
});
