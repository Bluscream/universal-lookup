/**
 * What a Hacker News account has submitted and commented, via Algolia.
 *
 * Not the Firebase API the enricher uses. Firebase gives a user's `submitted`
 * array as bare ids, newest first, which would mean one request per item just to
 * learn its title — thirty requests for five results. Algolia's HN index is the
 * officially blessed search API, is unauthenticated, and answers the same
 * question in one request with the items already populated.
 *
 * `search_by_date` rather than `search`, because relevance ranking is meaningless
 * when the query is "everything by this author" and recency is the whole point.
 */

import type { SocialAccount, SocialActivity } from '../../../types/common.js';
import { type DetailResult, defineDetailer, get } from '../shared.js';

const NAME = 'hackernews-activity';
const SEARCH_URL = 'https://hn.algolia.com/api/v1/search_by_date';

interface AlgoliaHit {
  objectID?: string;
  title?: string | null;
  story_title?: string | null;
  comment_text?: string | null;
  story_text?: string | null;
  url?: string | null;
  created_at?: string | null;
  points?: number | null;
  num_comments?: number | null;
  _tags?: string[];
}

interface AlgoliaResponse {
  hits?: AlgoliaHit[];
  nbHits?: number;
}

/** `_tags` carries `story` or `comment` alongside the author and ids. */
function kindOf(hit: AlgoliaHit): string {
  return hit._tags?.includes('comment') ? 'comment' : 'story';
}

export const hackernewsActivity = defineDetailer({
  name: NAME,
  platform: 'hackernews',
  // Unauthenticated, like the rest of the Hacker News surface.
  isAvailable: () => true,
  async read(account: SocialAccount, limit: number): Promise<DetailResult> {
    const handle = account.account?.trim();
    if (!handle) return {};

    const response = await get<AlgoliaResponse>(SEARCH_URL, {
      params: { tags: `author_${handle}`, hitsPerPage: String(limit) },
    });

    const activity: SocialActivity[] = (response.hits ?? []).map((hit) => ({
      kind: kindOf(hit),
      source: NAME,
      id: hit.objectID ?? null,
      // A comment has no title; the story it sits under is what identifies it.
      title: hit.title ?? hit.story_title ?? null,
      text: hit.comment_text ?? hit.story_text ?? null,
      // The HN item page, not the submitted link: it is what the account did.
      url: hit.objectID ? `https://news.ycombinator.com/item?id=${hit.objectID}` : null,
      time: hit.created_at ?? null,
      score: hit.points ?? null,
      metrics: { comments: hit.num_comments ?? null, submitted_url: hit.url ?? null },
    }));

    return {
      activity,
      details: response.nbHits !== undefined ? { total_items: response.nbHits } : undefined,
    };
  },
});
