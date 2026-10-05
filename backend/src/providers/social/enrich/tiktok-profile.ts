/**
 * TikTok profile facts, without pretending to be somebody else.
 *
 * TikTok has no API route to an arbitrary public handle: the Display API only
 * returns data for the user who logged into your own app, and the Research API
 * is academic/non-profit only and explicitly bars commercial use. It also will
 * not render `og:` link-preview tags for us — those go to an allowlist of named
 * crawlers, so the route used for Instagram and Threads does not work here, and
 * claiming to be `facebookexternalhit` to get them is not something this
 * codebase will do.
 *
 * Two honest routes remain, and this uses both.
 *
 * **The page's own data.** Probed with this project's own user-agent, naming
 * itself and its repository, `https://www.tiktok.com/@handle` returns its
 * `__UNIVERSAL_DATA_FOR_REHYDRATION__` blob — the state the page would hydrate
 * itself from — carrying the user and their stats. No impersonation, no
 * credentials, no session cookie. The counts there are **exact**
 * (`followerCount: 5519`, `videoCount: 242`), unlike the rounded figures the
 * link-preview tags would have given.
 *
 * **oEmbed**, `https://www.tiktok.com/oembed?url=…`, which is documented,
 * supported and unauthenticated. It carries no counts, but it answers 200 with
 * the display name for a real profile and 400 for one that does not exist — so
 * it is both a fallback when the page read is blocked and a second opinion on
 * whether an account is real.
 *
 * The honest caveat: the page read is the undocumented one. TikTok rate-limits
 * anonymous clients hard and the blob's shape is theirs to change, so a failure
 * here is expected often enough that it must never cost the caller the rest of
 * the lookup. Hence the fallback, and hence reporting what was read.
 */

import axios from 'axios';
import { config } from '../../../config.js';
import type { SocialAccount } from '../../../types/common.js';
import { defineEnricher, USER_AGENT } from '../shared.js';

const NAME = 'tiktok-profile';
const OEMBED_URL = 'https://www.tiktok.com/oembed';

/** Lifted out of the page as JSON; only the fields read here are described. */
interface Rehydration {
  __DEFAULT_SCOPE__?: {
    'webapp.user-detail'?: {
      /** 0 for a real profile. 10221 is the one a missing handle returns. */
      statusCode?: number;
      userInfo?: {
        user?: {
          id?: string;
          uniqueId?: string;
          nickname?: string;
          signature?: string;
          avatarLarger?: string;
          avatarMedium?: string;
          verified?: boolean;
          privateAccount?: boolean;
          createTime?: number;
          region?: string;
        };
        stats?: {
          followerCount?: number;
          followingCount?: number;
          heartCount?: number;
          videoCount?: number;
          friendCount?: number;
        };
      } | null;
    };
  };
}

interface OEmbed {
  author_name?: string;
  author_url?: string;
  title?: string;
  thumbnail_url?: string;
  embed_product_id?: string;
}

const BLOB = /<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/;

/** The rehydration blob, or null when the page did not carry a readable one. */
export function parseRehydration(html: string): Rehydration | null {
  const match = BLOB.exec(html);
  if (!match?.[1]) return null;
  try {
    return JSON.parse(match[1]) as Rehydration;
  } catch {
    // A truncated or re-shaped blob is a miss, not a crash: TikTok owns this
    // markup and may change it whenever it likes.
    return null;
  }
}

async function readPage(handle: string): Promise<Rehydration | null> {
  const response = await axios.get<string>(
    `https://www.tiktok.com/@${encodeURIComponent(handle)}`,
    {
      timeout: config.serverTimeout,
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
      responseType: 'text',
    },
  );
  return typeof response.data === 'string' ? parseRehydration(response.data) : null;
}

async function readOEmbed(handle: string): Promise<OEmbed | null> {
  const response = await axios.get<OEmbed>(OEMBED_URL, {
    params: { url: `https://www.tiktok.com/@${handle}` },
    timeout: config.serverTimeout,
    headers: { 'User-Agent': USER_AGENT },
    // A handle nobody holds answers 400 here, which is an answer rather than a
    // failure — unlike the page, which answers 200 either way.
    validateStatus: (status) => status === 200 || status === 400,
  });
  return response.status === 200 ? response.data : null;
}

export const tiktokProfile = defineEnricher({
  name: NAME,
  platform: 'tiktok',
  // No credentials of any kind.
  isAvailable: () => true,
  async read(account: SocialAccount): Promise<Partial<SocialAccount> | null> {
    const handle = account.account?.trim().replace(/^@+/, '');
    if (!handle) return null;

    // Both at once: oEmbed is cheap, documented, and is the answer when the page
    // read is rate-limited — which, being the undocumented half, it will be.
    const [page, oembed] = await Promise.all([
      readPage(handle).catch(() => null),
      readOEmbed(handle).catch(() => null),
    ]);

    const detail = page?.__DEFAULT_SCOPE__?.['webapp.user-detail'];
    const user = detail?.userInfo?.user;
    const stats = detail?.userInfo?.stats;

    if (user) {
      return {
        account: user.uniqueId ?? handle,
        account_id: user.id ?? null,
        url: `https://www.tiktok.com/@${user.uniqueId ?? handle}`,
        display_name: user.nickname ?? oembed?.author_name ?? null,
        description: user.signature || null,
        avatar: user.avatarLarger ?? user.avatarMedium ?? null,
        followers: stats?.followerCount ?? null,
        uploads: stats?.videoCount ?? null,
        // `heartCount` is likes received across every video, which is the
        // closest thing TikTok publishes to a view total — but it is not views,
        // so it is not reported as them.
        views: null,
        created_at: user.createTime ? new Date(user.createTime * 1000).toISOString() : null,
        metrics: {
          likes: stats?.heartCount ?? null,
          following: stats?.followingCount ?? null,
          friends: stats?.friendCount ?? null,
          verified: user.verified ?? null,
          private: user.privateAccount ?? null,
          region: user.region ?? null,
          read_from: 'page-data',
        },
      };
    }

    // The page said the handle does not exist, and oEmbed agrees by refusing it.
    // Distinguishing this from "the page read was blocked" is the whole reason
    // both are consulted: a blocked read must not be reported as a dead account.
    if (detail && !detail.userInfo && !oembed) return null;

    if (oembed) {
      // The page was blocked or re-shaped, but the account is real. Saying so
      // with a name and no counts beats both silence and a fabricated zero.
      return {
        account: oembed.embed_product_id ?? handle,
        url: oembed.author_url ?? `https://www.tiktok.com/@${handle}`,
        display_name: oembed.author_name ?? null,
        avatar: oembed.thumbnail_url ?? null,
        followers: null,
        uploads: null,
        metrics: {
          read_from: 'oembed',
          // Named outright, so nobody reads the missing counts as zero.
          counts_unavailable: 'TikTok page data was unreadable; only oEmbed answered',
        },
      };
    }

    return null;
  },
});
