/**
 * What a Reddit account has been posting and commenting.
 *
 * Shares the app token minted by the `reddit-user` enricher rather than keeping
 * a second cache: one set of credentials should make one token request an hour,
 * not two, against an endpoint Reddit rate-limits.
 *
 * Posts and comments are fetched separately because Reddit's combined `overview`
 * listing interleaves them under one cursor, so a prolific commenter's posts
 * fall off the end of the page entirely. Two listings cost one extra request and
 * guarantee both kinds are represented.
 */

import axios from 'axios';
import { config } from '../../../config.js';
import type { SocialAccount, SocialActivity } from '../../../types/common.js';
import { type DetailResult, defineDetailer, USER_AGENT } from '../shared.js';
import { appToken } from '../enrich/reddit-user.js';

const NAME = 'reddit-activity';
const API = 'https://oauth.reddit.com';

interface Listing<T> {
  data?: { children?: Array<{ data?: T }> };
}

interface Thing {
  id?: string;
  name?: string;
  title?: string;
  selftext?: string;
  body?: string;
  permalink?: string;
  url?: string;
  created_utc?: number;
  score?: number;
  num_comments?: number;
  subreddit?: string;
  link_title?: string;
  over_18?: boolean;
  stickied?: boolean;
}

/** Reddit timestamps are epoch seconds, as a float. */
function toIso(created: number | undefined): string | null {
  if (created === undefined) return null;
  return new Date(created * 1000).toISOString();
}

async function listing(path: string, token: string, limit: number): Promise<Thing[]> {
  const response = await axios.get<Listing<Thing>>(`${API}${path}`, {
    params: { limit, sort: 'new', raw_json: 1 },
    headers: { Authorization: `Bearer ${token}`, 'User-Agent': USER_AGENT },
    timeout: config.serverTimeout,
    // A suspended or deleted account 404s, and an account with nothing public
    // 403s. Neither is a broken endpoint, and neither should cost the caller
    // the other listing.
    validateStatus: (status) => status === 200 || status === 403 || status === 404,
  });
  return (response.data?.data?.children ?? [])
    .map((child) => child.data)
    .filter((thing): thing is Thing => thing !== undefined);
}

export const redditActivity = defineDetailer({
  name: NAME,
  platform: 'reddit',
  isAvailable: () => Boolean(config.redditClientId && config.redditClientSecret),
  async read(account: SocialAccount, limit: number): Promise<DetailResult> {
    const handle = account.account?.trim().replace(/^\/?u\//, '');
    if (!handle) return {};

    const token = await appToken();
    const user = encodeURIComponent(handle);
    const [posts, comments] = await Promise.all([
      listing(`/user/${user}/submitted`, token, limit),
      listing(`/user/${user}/comments`, token, limit),
    ]);

    const activity: SocialActivity[] = [
      ...posts.map((post) => ({
        kind: 'post',
        source: NAME,
        id: post.id ?? null,
        title: post.title ?? null,
        text: post.selftext || null,
        url: post.permalink ? `https://reddit.com${post.permalink}` : (post.url ?? null),
        time: toIso(post.created_utc),
        score: post.score ?? null,
        metrics: {
          subreddit: post.subreddit ?? null,
          comments: post.num_comments ?? null,
          nsfw: post.over_18 ?? null,
        },
      })),
      ...comments.map((comment) => ({
        kind: 'comment',
        source: NAME,
        id: comment.id ?? null,
        // A comment has no title of its own; the post it is on is the context
        // that makes it readable at all.
        title: comment.link_title ?? null,
        text: comment.body ?? null,
        url: comment.permalink ? `https://reddit.com${comment.permalink}` : null,
        time: toIso(comment.created_utc),
        score: comment.score ?? null,
        metrics: { subreddit: comment.subreddit ?? null },
      })),
    ];

    return { activity };
  },
});
