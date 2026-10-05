/**
 * The per-platform readers: profile urls, sub-providers, viewer avatars,
 * link-preview tags, TikTok's page data and Synchra's stream history.
 *
 * Split from social.test.ts, which covers the graph itself — discovery, merging,
 * grouping and the fallback chain. One file had grown past the repo's 1000-line
 * limit, and the seam between "how accounts are found and merged" and "what each
 * platform says about one" is the natural place to cut.
 */

import type { ChatMessage } from 'synchra-ts';
import { beforeEach, describe, expect, it } from 'vitest';
import { durationSeconds } from '../backend/src/providers/social/detail/youtube-uploads.js';
import {
  parseCount,
  parseCounts,
  parseDisplayName,
  parseOpenGraph,
  toAccount,
} from '../backend/src/providers/social/enrich/open-graph.js';
import { parseRehydration } from '../backend/src/providers/social/enrich/tiktok-profile.js';
import { profileUrl } from '../backend/src/providers/social/profile-url.js';
import { defineDetailer } from '../backend/src/providers/social/shared.js';
import { recentStreams } from '../backend/src/providers/social/streams.js';
import {
  resetViewerAvatars,
  viewerAvatars,
} from '../backend/src/providers/social/viewer-avatars.js';
import type { SocialAccount } from '../backend/src/types/common.js';

function account(partial: Partial<SocialAccount> & { platform: string }): SocialAccount {
  return { sources: ['test'], ...partial };
}

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

describe('viewer avatars', () => {
  function fakeViewerInfo(urls: Record<string, string | null>, onCall: (id: string) => void) {
    return {
      channelViewer: {
        providerViewerInfo: async (params: { provider: string; provider_viewer_id: string }) => {
          const id = `${params.provider}:${params.provider_viewer_id}`;
          onCall(id);
          if (!(id in urls)) throw new Error('403 Forbidden');
          return { profile_picture_url: urls[id] };
        },
      },
    };
  }

  function message(partial: Partial<ChatMessage> & { provider_viewer_id: string }) {
    return { provider: 'twitch', ...partial } as ChatMessage;
  }

  beforeEach(() => {
    resetViewerAvatars();
  });

  it('never looks up a viewer whose message already carried a picture', async () => {
    const calls: string[] = [];
    const resolved = await viewerAvatars(
      fakeViewerInfo({}, (id) => calls.push(id)),
      'channel',
      [
        message({
          provider: 'tiktok',
          provider_viewer_id: '1',
          viewer_profile_picture_url: 'https://cdn/tiktok.jpg',
        }),
      ],
    );

    expect(calls).toEqual([]);
    expect(resolved.get('tiktok:1')).toBe('https://cdn/tiktok.jpg');
  });

  it('looks a chatter up once however much they talk', async () => {
    const calls: string[] = [];
    const source = fakeViewerInfo({ 'twitch:7': 'https://cdn/a.png' }, (id) => calls.push(id));
    const messages = Array.from({ length: 12 }, () => message({ provider_viewer_id: '7' }));

    const resolved = await viewerAvatars(source, 'channel', messages);

    // Cached per viewer, not per message: twelve lines, one request.
    expect(calls).toEqual(['twitch:7']);
    expect(resolved.get('twitch:7')).toBe('https://cdn/a.png');
  });

  it('remembers a miss, so a token that cannot read viewers is asked once', async () => {
    const calls: string[] = [];
    // Nothing configured, so every lookup throws 403 — the shape of a token
    // without viewer access.
    const source = fakeViewerInfo({}, (id) => calls.push(id));

    await viewerAvatars(source, 'channel', [message({ provider_viewer_id: '9' })]);
    await viewerAvatars(source, 'channel', [message({ provider_viewer_id: '9' })]);

    expect(calls).toEqual(['twitch:9']);
  });

  it('rations a cold start instead of firing one request per chatter', async () => {
    const calls: string[] = [];
    const source = fakeViewerInfo({}, (id) => calls.push(id));
    const messages = Array.from({ length: 30 }, (_, i) =>
      message({ provider_viewer_id: String(i) }),
    );

    await viewerAvatars(source, 'channel', messages);

    // Thirty unknown chatters must not mean thirty requests on one refresh;
    // the rest are picked up by the next call.
    expect(calls).toHaveLength(6);
  });
});

describe('reading a profile from its link-preview tags', () => {
  it('reads the counts Instagram writes into og:description', () => {
    const counts = parseCounts(
      '165 Followers, 132 Following, 104 Posts - See Instagram photos and videos from Bleichi Loveless (@bleichi_loveless)',
    );

    expect(counts).toMatchObject({ followers: 165, following: 132, posts: 104 });
  });

  it('reads the ones Threads writes, with its different separators', () => {
    const counts = parseCounts(
      '15 Followers • 18 Threads. See the latest conversations with @bleichi_loveless.',
    );

    expect(counts).toMatchObject({ followers: 15, threads: 18 });
  });

  it('expands the abbreviations a display string uses', () => {
    // These are rendered for humans, so every shape a human would read turns up.
    expect(parseCount('1,234')).toBe(1234);
    expect(parseCount('15.4k')).toBe(15400);
    expect(parseCount('2.1M')).toBe(2_100_000);
    expect(parseCount('1.5B')).toBe(1_500_000_000);
    expect(parseCount('5519')).toBe(5519);
  });

  it('returns null, not zero, for a count it cannot read', () => {
    // Zero followers and an unparseable count are different answers, and
    // reporting the second as the first would be a confident lie.
    expect(parseCount(undefined)).toBeNull();
    expect(parseCount('')).toBeNull();
    expect(parseCount('lots')).toBeNull();
  });

  it('takes the display name only when the title carries a handle', () => {
    expect(
      parseDisplayName('Bleichi Loveless (@bleichi_loveless) • Instagram photos and videos'),
    ).toBe('Bleichi Loveless');
    // The signed-out landing page, which is what a missing account serves.
    expect(parseDisplayName('Threads')).toBeNull();
    expect(parseDisplayName(undefined)).toBeNull();
  });

  it('pulls the tags out of a page, by property or by name', () => {
    const og = parseOpenGraph(
      '<html><head><meta property="og:title" content="A (@b)"><meta name="og:image" content="https://cdn/a.jpg"></head></html>',
    );

    expect(og.title).toBe('A (@b)');
    expect(og.image).toBe('https://cdn/a.jpg');
    expect(og.description).toBeUndefined();
  });

  it('marks the counts as rounded, because they are', () => {
    // A caller comparing 15.4k against an API's 15,431 deserves to know why.
    const built = toAccount(
      { url: 'https://x/y', title: 'A (@b)', image: 'https://cdn/a.jpg' },
      'b',
      { followers: 15400 },
      'followers',
      'posts',
      'test',
    );

    expect(built.metrics?.counts_are_rounded).toBe(true);
    expect(built.metrics?.read_from).toBe('open-graph');
    expect(built.followers).toBe(15400);
    // No posts count in the description means null, not zero.
    expect(built.uploads).toBeNull();
  });
});

describe("TikTok's page data", () => {
  const blob = (payload: unknown) =>
    `<html><head><script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify(payload)}</script></head></html>`;

  it('reads the state the page would have hydrated itself from', () => {
    const parsed = parseRehydration(
      blob({
        __DEFAULT_SCOPE__: {
          'webapp.user-detail': {
            statusCode: 0,
            userInfo: { user: { uniqueId: 'someone' }, stats: { followerCount: 5519 } },
          },
        },
      }),
    );

    const detail = parsed?.__DEFAULT_SCOPE__?.['webapp.user-detail'];
    expect(detail?.userInfo?.user?.uniqueId).toBe('someone');
    expect(detail?.userInfo?.stats?.followerCount).toBe(5519);
  });

  it('returns null for a page with no blob, rather than throwing', () => {
    // TikTok owns this markup and may rename or restructure it at any time.
    expect(parseRehydration('<html><head></head></html>')).toBeNull();
  });

  it('returns null for a truncated blob, rather than throwing', () => {
    expect(
      parseRehydration(
        '<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__">{"__DEFAULT_SCOPE__":</script>',
      ),
    ).toBeNull();
  });

  it('distinguishes a missing account from an unreadable page', () => {
    // The distinction that matters: a handle nobody holds answers 200 with
    // userInfo null and statusCode 10221, while a blocked read answers with no
    // usable blob at all. Reporting the second as the first would mark a live
    // account dead every time TikTok rate-limited us.
    const missing = parseRehydration(
      blob({ __DEFAULT_SCOPE__: { 'webapp.user-detail': { statusCode: 10221, userInfo: null } } }),
    );
    const detail = missing?.__DEFAULT_SCOPE__?.['webapp.user-detail'];

    expect(detail).toBeDefined();
    expect(detail?.userInfo).toBeNull();

    // A blocked read has no detail section to consult at all.
    expect(parseRehydration('<html></html>')?.__DEFAULT_SCOPE__).toBeUndefined();
  });
});

describe('Synchra stream history', () => {
  function source(records: unknown[] | Error) {
    return {
      channelStream: {
        getChannelStreams: async () => {
          if (records instanceof Error) throw records;
          return { records };
        },
      },
    };
  }

  it('flattens a session, keeping every platform it went out to', async () => {
    const streams = await recentStreams(
      source([
        {
          id: 's1',
          started_at: '2026-04-19T18:42:15Z',
          duration_seconds: 19998,
          providers: ['tiktok', 'twitch'],
          avg_viewer_count: 7,
          peak_viewer_count: 15,
          chat_message_count: 1061,
          unique_chatter_count: 162,
        },
      ]),
      'channel',
      5,
    );

    expect(streams[0]).toMatchObject({
      id: 's1',
      duration_seconds: 19998,
      // One broadcast, several platforms — which is why this is not filed under
      // an account.
      platforms: ['tiktok', 'twitch'],
      peak_viewers: 15,
      chat_messages: 1061,
      unique_chatters: 162,
    });
  });

  it('carries no live flag, because the record has nothing that means live', async () => {
    // `duration_seconds` is null on records months old — confirmed against the
    // live API — so inferring "live" from it would have marked a channel live
    // for half a year.
    const streams = await recentStreams(
      source([{ id: 's2', started_at: '2026-04-18T11:40:00Z', duration_seconds: null }]),
      'channel',
      5,
    );

    expect(streams[0]?.duration_seconds).toBeNull();
    expect(streams[0]).not.toHaveProperty('live');
    expect(streams[0]).not.toHaveProperty('is_live');
  });

  it('answers an inaccessible channel with nothing, not an error', async () => {
    // 403 is the expected answer for any channel the token does not own, and
    // means "not available here" — surfacing it would make a complete lookup
    // look broken.
    await expect(
      recentStreams(source(new Error('403: You do not have access to this channel')), 'channel', 5),
    ).resolves.toEqual([]);
  });
});
