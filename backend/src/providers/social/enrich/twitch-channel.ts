/**
 * Twitch channel facts, via Twurple — the de-facto Twitch client for Node.
 *
 * Needs TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET, which are new. They are an
 * *app* registration, not a user login: the client-credentials flow Twurple's
 * `AppTokenAuthProvider` performs gives access to public channel data and
 * nothing belonging to any account, so this never acts on anyone's behalf.
 *
 * Follower counts are the one thing Twitch took away. `GET /channels/followers`
 * has required the broadcaster's own token since 2023, so an app token can read
 * a channel's profile, views and schedule but not how many people follow it.
 * `followers` therefore stays null here rather than being filled with something
 * else that sounds similar.
 */

import { ApiClient } from '@twurple/api';
import { AppTokenAuthProvider } from '@twurple/auth';
import { config } from '../../../config.js';
import type { SocialAccount } from '../../../types/common.js';
import { defineEnricher } from '../shared.js';

const NAME = 'twitch-channel';

let client: ApiClient | undefined;

/**
 * One client, reused, because it caches the app token.
 *
 * Built lazily: constructing an `AppTokenAuthProvider` with empty credentials
 * throws, and this module is imported whether or not Twitch is configured.
 */
function api(): ApiClient {
  client ??= new ApiClient({
    authProvider: new AppTokenAuthProvider(config.twitchClientId, config.twitchClientSecret),
  });
  return client;
}

export const twitchChannel = defineEnricher({
  name: NAME,
  platform: 'twitch',
  isAvailable: () => Boolean(config.twitchClientId && config.twitchClientSecret),
  async read(account: SocialAccount): Promise<Partial<SocialAccount> | null> {
    const handle = account.account?.trim();
    const id = account.account_id?.trim();
    if (!handle && !id) return null;

    const user = id
      ? await api().users.getUserById(id)
      : await api().users.getUserByName(handle as string);
    if (!user) return null;

    // The stream is a separate call and only exists while they are live, so a
    // null here is "offline", not a failure.
    const stream = await api().streams.getStreamByUserId(user.id);

    return {
      account: user.name,
      account_id: user.id,
      url: `https://twitch.tv/${user.name}`,
      display_name: user.displayName,
      description: user.description || null,
      avatar: user.profilePictureUrl,
      // Deliberately not set — see the note at the top of this file.
      followers: null,
      // No `views` either: Twitch removed channel view counts in 2022 and
      // Twurple 8 dropped the property with them.
      created_at: user.creationDate.toISOString(),
      broadcaster_type: user.broadcasterType || null,
      live: stream !== null,
      stream_title: stream?.title ?? null,
      stream_game: stream?.gameName ?? null,
      stream_viewers: stream?.viewers ?? null,
      stream_started_at: stream?.startDate.toISOString() ?? null,
    };
  },
  async findByName(handle: string): Promise<Partial<SocialAccount>[]> {
    // `searchChannels` is Twitch's own channel search and is all an app token
    // can reach — there is no user search in Helix. It returns channels, which
    // is the same thing for this purpose: on Twitch a user *is* a channel.
    const { data } = await api().search.searchChannels(handle, { limit: 5 });
    return data.map((hit) => ({
      account: hit.name,
      account_id: hit.id,
      url: `https://twitch.tv/${hit.name}`,
      display_name: hit.displayName,
      avatar: hit.thumbnailUrl,
      live: hit.isLive,
      stream_game: hit.gameName || null,
    }));
  },
});
