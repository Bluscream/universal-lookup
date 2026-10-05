/**
 * YouTube channel statistics, via Google's own `@googleapis/youtube` client.
 *
 * Reuses GOOGLE_API_KEY, which this service already reads for Google search, so
 * there is no new credential — but the key does need the **YouTube Data API v3**
 * enabled on its Cloud project, which a search-only key will not have. That
 * shows up as a 403 naming the disabled API, and is reported verbatim rather
 * than swallowed, because "enable the API" is the fix and the message says so.
 *
 * Two kinds of claim arrive here. Harbor records YouTube claims with the channel
 * id (`UC…`), which `channels.list(id)` answers directly. Keybase and a bare
 * handle give only `@name`, which needs `forHandle` — a newer parameter, and the
 * reason this is not one call.
 */

import { youtube, type youtube_v3 } from '@googleapis/youtube';
import { config } from '../../../config.js';
import type { SocialAccount } from '../../../types/common.js';
import { defineEnricher } from '../shared.js';

const NAME = 'youtube-channel';

let client: youtube_v3.Youtube | undefined;

function api(): youtube_v3.Youtube {
  client ??= youtube({ version: 'v3', auth: config.googleApiKey });
  return client;
}

const PARTS = ['snippet', 'statistics', 'brandingSettings'];

/** A count YouTube returns as a decimal string, or null when it is hidden. */
function count(value: string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

export const youtubeChannel = defineEnricher({
  name: NAME,
  platform: 'youtube',
  isAvailable: () => Boolean(config.googleApiKey),
  async read(account: SocialAccount): Promise<Partial<SocialAccount> | null> {
    const id = account.account_id?.trim();
    const handle = account.account?.trim().replace(/^@+/, '');
    if (!id && !handle) return null;

    // By id when the claim carried one, which is exact. A handle is a lookup,
    // and handles are reassignable — so an id is preferred whenever both exist.
    const response = await api().channels.list(
      id ? { part: PARTS, id: [id] } : { part: PARTS, forHandle: `@${handle}` },
    );

    const channel = response.data.items?.[0];
    if (!channel) return null;

    const stats = channel.statistics;
    return {
      account: channel.snippet?.customUrl ?? (handle ? `@${handle}` : null),
      account_id: channel.id ?? null,
      url: channel.id ? `https://www.youtube.com/channel/${channel.id}` : null,
      display_name: channel.snippet?.title ?? null,
      description: channel.snippet?.description ?? null,
      avatar: channel.snippet?.thumbnails?.high?.url ?? channel.snippet?.thumbnails?.default?.url,
      // `subscriberCount` is absent entirely when the channel hides it, which
      // is not zero and must not read as zero.
      followers: count(stats?.subscriberCount),
      uploads: count(stats?.videoCount),
      views: count(stats?.viewCount),
      created_at: channel.snippet?.publishedAt ?? null,
      metrics: {
        subscribers: count(stats?.subscriberCount),
        subscriber_count_hidden: stats?.hiddenSubscriberCount ?? null,
        country: channel.snippet?.country ?? null,
        keywords: channel.brandingSettings?.channel?.keywords ?? null,
      },
    };
  },
});
