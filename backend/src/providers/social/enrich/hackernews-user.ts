/**
 * Hacker News profile facts, from the official Firebase API.
 *
 * No client library here either: the API is one documented, unauthenticated,
 * uncached GET per user and the npm wrappers for it are all unmaintained. The
 * endpoint is HN's own and is the one Y Combinator documents.
 *
 * HN has no followers and no avatars — karma and the account age are the whole
 * profile — so most fields stay null rather than being filled with a stand-in.
 */

import type { SocialAccount } from '../../../types/common.js';
import { defineEnricher, getAllowing404 } from '../shared.js';

const NAME = 'hackernews-user';

interface HnUser {
  id?: string;
  created?: number;
  karma?: number;
  about?: string;
  submitted?: unknown[];
}

export const hackernewsUser = defineEnricher({
  name: NAME,
  platform: 'hackernews',
  isAvailable: () => true,
  async read(account: SocialAccount): Promise<Partial<SocialAccount> | null> {
    const handle = account.account?.trim();
    if (!handle) return null;

    // An unknown user answers 200 with a literal `null` body, not a 404.
    const user = await getAllowing404<HnUser | null>(
      `https://hacker-news.firebaseio.com/v0/user/${encodeURIComponent(handle)}.json`,
    );
    if (!user?.id) return null;

    return {
      account: user.id,
      url: `https://news.ycombinator.com/user?id=${user.id}`,
      description: user.about ?? null,
      // `submitted` is every item id they ever posted, so its length is a real
      // submission count — but the array is large and is not worth publishing.
      uploads: user.submitted?.length ?? null,
      created_at: user.created === undefined ? null : new Date(user.created * 1000).toISOString(),
      metrics: { karma: user.karma ?? null },
    };
  },
});
