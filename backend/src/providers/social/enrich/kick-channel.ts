/**
 * Kick channel facts, via Kick's own public API.
 *
 * The one platform in this lookup besides Twitch with a sanctioned route to an
 * arbitrary public handle that needs nobody's personal account. Kick's OAuth 2.1
 * supports a `client_credentials` app token, documented for "publicly available
 * data … when user login is not required", and `GET /public/v1/channels?slug=`
 * answers with it. Free, 300 requests a minute.
 *
 * Register an app at kick.com/settings/developer to get KICK_CLIENT_ID and
 * KICK_CLIENT_SECRET. Without them this reports itself unconfigured, exactly as
 * the Twitch and Reddit readers do.
 *
 * Two things Kick does not publish on this endpoint, named so their absence is
 * not read as zero. There is **no follower count** — `subscriber_count` is a
 * different thing and is reported under its own name — and there is no video or
 * clip list, so Kick has no sub-provider.
 *
 * Unlike every other reader here, this one *does* carry live status: `stream`
 * holds `is_live` and a viewer count straight from Kick.
 */

import axios from 'axios';
import { config } from '../../../config.js';
import type { SocialAccount } from '../../../types/common.js';
import { defineEnricher, USER_AGENT } from '../shared.js';

const NAME = 'kick-channel';
/** The OAuth server is a different host from the API. */
const TOKEN_URL = 'https://id.kick.com/oauth/token';
const API = 'https://api.kick.com/public/v1';

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
}

interface KickChannel {
  broadcaster_user_id?: number;
  slug?: string;
  channel_description?: string;
  banner_picture?: string;
  stream_title?: string;
  category?: { id?: number; name?: string; thumbnail?: string } | null;
  stream?: {
    is_live?: boolean;
    viewer_count?: number;
    start_time?: string;
    language?: string;
    is_mature?: boolean;
    thumbnail?: string;
  } | null;
  subscriber_count?: number;
  gifted_subscriber_count?: number;
}

interface ChannelsResponse {
  data?: KickChannel[];
}

/**
 * The app token, cached until shortly before it expires.
 *
 * Same reasoning as the Reddit reader: minting one per account read would waste
 * a request and walk into the rate limit the token endpoint imposes. The
 * 60-second margin stops a token being used that expires mid-request.
 */
let cached: { token: string; expiresAt: number } | undefined;

/** Drop the cached token, so the next read mints one. Used by the tests. */
export function resetKickToken(): void {
  cached = undefined;
}

export async function appToken(): Promise<string> {
  if (cached && Date.now() < cached.expiresAt) return cached.token;

  const response = await axios.post<TokenResponse>(
    TOKEN_URL,
    new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: config.kickClientId,
      client_secret: config.kickClientSecret,
    }),
    {
      headers: { 'User-Agent': USER_AGENT, 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: config.serverTimeout,
    },
  );

  const token = response.data.access_token;
  if (!token) throw new Error('Kick returned no access_token for the client-credentials grant');

  cached = {
    token,
    expiresAt: Date.now() + Math.max((response.data.expires_in ?? 3600) - 60, 60) * 1000,
  };
  return token;
}

export const kickChannel = defineEnricher({
  name: NAME,
  platform: 'kick',
  isAvailable: () => Boolean(config.kickClientId && config.kickClientSecret),
  async read(account: SocialAccount): Promise<Partial<SocialAccount> | null> {
    const handle = account.account?.trim().replace(/^@+/, '');
    if (!handle) return null;

    const token = await appToken();
    const response = await axios.get<ChannelsResponse>(`${API}/channels`, {
      params: { slug: handle },
      headers: { Authorization: `Bearer ${token}`, 'User-Agent': USER_AGENT },
      timeout: config.serverTimeout,
      // Kick answers an unknown slug with an empty list rather than a 404, but
      // a 404 is allowed here too so a route change does not read as a failure.
      validateStatus: (status) => status === 200 || status === 404,
    });

    const channel = response.data?.data?.[0];
    if (!channel?.slug) return null;

    const stream = channel.stream;
    return {
      account: channel.slug,
      account_id:
        channel.broadcaster_user_id !== undefined ? String(channel.broadcaster_user_id) : null,
      url: `https://kick.com/${channel.slug}`,
      description: channel.channel_description || null,
      avatar: channel.banner_picture ?? null,
      // Kick does not publish a follower count on this endpoint. Subscribers are
      // a different, paid relationship and are reported as themselves below.
      followers: null,
      live: stream?.is_live ?? false,
      stream_title: channel.stream_title || null,
      stream_category: channel.category?.name ?? null,
      stream_viewers: stream?.viewer_count ?? null,
      stream_started_at: stream?.start_time ?? null,
      stream_language: stream?.language ?? null,
      mature: stream?.is_mature ?? null,
      subscribers: channel.subscriber_count ?? null,
      gifted_subscribers: channel.gifted_subscriber_count ?? null,
    };
  },
});
