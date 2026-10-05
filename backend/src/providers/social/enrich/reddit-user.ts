/**
 * Reddit profile facts, via Reddit's app-only OAuth.
 *
 * The public `about.json` this was first written against is gone. Probed in
 * October 2026, every anonymous route answers 403 — `www.reddit.com`,
 * `api.reddit.com`, with and without a JSON `Accept`, and with Reddit's own
 * documented user-agent format — while `old.reddit.com` answers **200 with an
 * HTML interstitial**, which is worse: a reader that trusts the status code
 * sees a success with no fields and reports a missing account.
 *
 * So this needs credentials, and it gates on them rather than failing once per
 * account at request time. They are an *app* registration (type "script", from
 * https://www.reddit.com/prefs/apps), and the client-credentials grant below is
 * app-only — it reads public profiles and can act for no user.
 *
 * No client library, deliberately. `snoowrap` is the only real Node wrapper, it
 * is unmaintained, and it wants a full user login for what is two requests here.
 */

import axios from 'axios';
import { config } from '../../../config.js';
import type { SocialAccount } from '../../../types/common.js';
import { defineEnricher, getAllowing404, USER_AGENT } from '../shared.js';

const NAME = 'reddit-user';
const TOKEN_URL = 'https://www.reddit.com/api/v1/access_token';
const API = 'https://oauth.reddit.com';

interface AboutResponse {
  data?: {
    name?: string;
    id?: string;
    icon_img?: string;
    created_utc?: number;
    link_karma?: number;
    comment_karma?: number;
    total_karma?: number;
    is_employee?: boolean;
    is_mod?: boolean;
    is_gold?: boolean;
    verified?: boolean;
    subreddit?: { title?: string; public_description?: string; subscribers?: number };
  };
}

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
}

/**
 * The app token, cached until shortly before it expires.
 *
 * Reddit issues these for an hour and rate-limits the token endpoint, so
 * fetching one per account read would be both wasteful and self-defeating. The
 * 60-second margin stops a token being used that expires mid-request.
 */
let cached: { token: string; expiresAt: number } | undefined;

async function appToken(): Promise<string> {
  if (cached && Date.now() < cached.expiresAt) return cached.token;

  const response = await axios.post<TokenResponse>(
    TOKEN_URL,
    new URLSearchParams({ grant_type: 'client_credentials' }),
    {
      auth: { username: config.redditClientId, password: config.redditClientSecret },
      headers: { 'User-Agent': USER_AGENT, 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: config.serverTimeout,
    },
  );

  const token = response.data.access_token;
  if (!token) throw new Error('Reddit returned no access_token for the client-credentials grant');

  cached = {
    token,
    expiresAt: Date.now() + Math.max((response.data.expires_in ?? 3600) - 60, 60) * 1000,
  };
  return token;
}

/** Drop the cached app token, so the next read fetches one. Used by the tests. */
export function resetRedditToken(): void {
  cached = undefined;
}

export const redditUser = defineEnricher({
  name: NAME,
  platform: 'reddit',
  isAvailable: () => Boolean(config.redditClientId && config.redditClientSecret),
  async read(account: SocialAccount): Promise<Partial<SocialAccount> | null> {
    const handle = account.account?.trim().replace(/^\/?u\//, '');
    if (!handle) return null;

    const token = await appToken();
    // A deleted or suspended account answers 404, which is a stale claim rather
    // than a broken endpoint.
    const response = await getAllowing404<AboutResponse>(
      `${API}/user/${encodeURIComponent(handle)}/about`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const data = response?.data;
    if (!data?.name) return null;

    return {
      account: data.name,
      account_id: data.id ?? null,
      url: `https://reddit.com/user/${data.name}`,
      display_name: data.subreddit?.title || data.name,
      description: data.subreddit?.public_description || null,
      // The icon URL is HTML-escaped in Reddit's JSON.
      avatar: data.icon_img?.replace(/&amp;/g, '&') ?? null,
      // A profile's subreddit subscribers are the closest thing Reddit has to
      // followers; karma is a separate idea and stays under `metrics`.
      followers: data.subreddit?.subscribers ?? null,
      created_at:
        data.created_utc === undefined ? null : new Date(data.created_utc * 1000).toISOString(),
      metrics: {
        link_karma: data.link_karma ?? null,
        comment_karma: data.comment_karma ?? null,
        total_karma: data.total_karma ?? null,
        is_employee: data.is_employee ?? null,
        is_mod: data.is_mod ?? null,
        is_gold: data.is_gold ?? null,
        verified: data.verified ?? null,
      },
    };
  },
});
