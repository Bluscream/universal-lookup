/**
 * What a YouTube channel has published: its most recent uploads.
 *
 * Deliberately not `search.list`. Search costs 100 quota units against a
 * default daily 10,000 and returns an approximate, index-lagged answer. Every
 * channel instead has an "uploads" playlist whose id is in its own
 * `contentDetails`, and reading it is exact and costs 1 unit per call — so the
 * route here is channels.list -> uploads playlist id -> playlistItems.list, two
 * cheap exact calls instead of one expensive fuzzy one.
 *
 * Statistics come from a third call, because `playlistItems` carries titles but
 * no view counts. It is skipped when the playlist was empty.
 */

import { youtube, type youtube_v3 } from '@googleapis/youtube';
import { config } from '../../../config.js';
import type { SocialAccount, SocialActivity } from '../../../types/common.js';
import { type DetailResult, defineDetailer } from '../shared.js';

const NAME = 'youtube-uploads';

let client: youtube_v3.Youtube | undefined;

function api(): youtube_v3.Youtube {
  client ??= youtube({ version: 'v3', auth: config.googleApiKey });
  return client;
}

/** A count YouTube returns as a decimal string, or null when it is hidden. */
function count(value: string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

/** `PT1H2M3S` -> seconds. YouTube reports durations as ISO 8601 periods. */
export function durationSeconds(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const match = /^P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso);
  if (!match) return null;
  const [, days, hours, minutes, seconds] = match;
  return (
    Number(days ?? 0) * 86400 +
    Number(hours ?? 0) * 3600 +
    Number(minutes ?? 0) * 60 +
    Number(seconds ?? 0)
  );
}

async function uploadsPlaylistId(account: SocialAccount): Promise<string | null> {
  const id = account.account_id?.trim();
  const handle = account.account?.trim().replace(/^@+/, '');
  if (!id && !handle) return null;

  const response = await api().channels.list(
    id
      ? { part: ['contentDetails'], id: [id] }
      : { part: ['contentDetails'], forHandle: `@${handle}` },
  );
  return response.data.items?.[0]?.contentDetails?.relatedPlaylists?.uploads ?? null;
}

export const youtubeUploads = defineDetailer({
  name: NAME,
  platform: 'youtube',
  isAvailable: () => Boolean(config.googleApiKey),
  async read(account: SocialAccount, limit: number): Promise<DetailResult> {
    const playlist = await uploadsPlaylistId(account);
    if (!playlist) return {};

    const items = await api().playlistItems.list({
      part: ['snippet', 'contentDetails'],
      playlistId: playlist,
      maxResults: limit,
    });

    const entries = items.data.items ?? [];
    if (entries.length === 0) return {};

    const videoIds = entries
      .map((item) => item.contentDetails?.videoId)
      .filter((id): id is string => Boolean(id));

    // One batched call for every video's counts, not one per video.
    const stats = await api()
      .videos.list({ part: ['statistics', 'contentDetails'], id: videoIds })
      .then((response) => new Map((response.data.items ?? []).map((v) => [v.id, v])))
      .catch(() => new Map<string | null | undefined, youtube_v3.Schema$Video>());

    const activity: SocialActivity[] = entries.map((item) => {
      const videoId = item.contentDetails?.videoId ?? null;
      const video = videoId ? stats.get(videoId) : undefined;
      return {
        kind: 'video',
        source: NAME,
        id: videoId,
        title: item.snippet?.title ?? null,
        text: item.snippet?.description ?? null,
        url: videoId ? `https://www.youtube.com/watch?v=${videoId}` : null,
        // The publish date, not the date it was added to the playlist.
        time: item.contentDetails?.videoPublishedAt ?? item.snippet?.publishedAt ?? null,
        views: count(video?.statistics?.viewCount),
        score: count(video?.statistics?.likeCount),
        duration: durationSeconds(video?.contentDetails?.duration),
        metrics: {
          comments: count(video?.statistics?.commentCount),
          thumbnail: item.snippet?.thumbnails?.medium?.url ?? null,
          definition: video?.contentDetails?.definition ?? null,
        },
      };
    });

    return { activity, details: { uploads_playlist: playlist } };
  },
});
