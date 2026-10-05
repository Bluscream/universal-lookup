/**
 * What a Twitch channel has published: past broadcasts, popular clips, and the
 * stream schedule.
 *
 * All three are reachable with the app token the enricher already mints, which
 * is why this adds no configuration — unlike follower counts, which need the
 * broadcaster's own token and so are absent from both stages.
 *
 * The schedule is the one part that is not a published thing and so does not
 * belong in `activity`: it is a plan, not an item, and listing a future stream
 * beside a past broadcast would make the two indistinguishable once sorted by
 * time. It goes in `details`.
 */

import { ApiClient } from '@twurple/api';
import { AppTokenAuthProvider } from '@twurple/auth';
import { config } from '../../../config.js';
import type { SocialAccount, SocialActivity } from '../../../types/common.js';
import { type DetailResult, defineDetailer } from '../shared.js';

const NAME = 'twitch-videos';

let client: ApiClient | undefined;

/** Lazy, because constructing the auth provider with empty credentials throws. */
function api(): ApiClient {
  client ??= new ApiClient({
    authProvider: new AppTokenAuthProvider(config.twitchClientId, config.twitchClientSecret),
  });
  return client;
}

export const twitchVideos = defineDetailer({
  name: NAME,
  platform: 'twitch',
  isAvailable: () => Boolean(config.twitchClientId && config.twitchClientSecret),
  async read(account: SocialAccount, limit: number): Promise<DetailResult> {
    // Every endpoint here is addressed by broadcaster id, never by name. The
    // enricher resolves one, so by this stage it is normally present; a lookup
    // that reached here without one has nothing to ask about.
    const id = account.account_id?.trim();
    if (!id) return {};

    const [videos, clips, schedule] = await Promise.all([
      api().videos.getVideosByUser(id, { limit }),
      api().clips.getClipsForBroadcaster(id, { limit }),
      // A channel with no schedule is the common case, and Twitch answers it
      // with an error rather than an empty list.
      api()
        .schedule.getSchedule(id, { limit: 5 })
        .catch(() => null),
    ]);

    const activity: SocialActivity[] = [
      ...videos.data.map((video) => ({
        kind: 'video',
        source: NAME,
        id: video.id,
        title: video.title,
        text: video.description || null,
        url: video.url,
        time: video.publishDate.toISOString(),
        views: video.views,
        duration: video.durationInSeconds,
        metrics: { type: video.type, language: video.language },
      })),
      ...clips.data.map((clip) => ({
        kind: 'clip',
        source: NAME,
        id: clip.id,
        title: clip.title,
        url: clip.url,
        time: clip.creationDate.toISOString(),
        views: clip.views,
        duration: clip.duration,
        // Who made the clip is worth keeping: a clip is published *about* this
        // channel, usually by somebody else.
        metrics: { creator: clip.creatorDisplayName, game_id: clip.gameId },
      })),
    ];

    const details: Record<string, unknown> = {};
    const segments = schedule?.data.segments ?? [];
    if (segments.length > 0) {
      details.schedule = segments.map((segment) => ({
        id: segment.id,
        title: segment.title,
        start: segment.startDate.toISOString(),
        end: segment.endDate.toISOString(),
        category: segment.categoryName,
        recurring: segment.isRecurring,
      }));
    }

    return { activity, details: Object.keys(details).length > 0 ? details : undefined };
  },
});
