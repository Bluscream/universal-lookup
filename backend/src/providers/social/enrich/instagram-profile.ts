/**
 * Instagram profile facts, from the profile page's Open Graph tags.
 *
 * There is no API route to an arbitrary public handle. Basic Display was shut
 * off on 4 December 2024, and its replacement reads only Business/Creator
 * accounts, through a Meta app each deployer would have to register and get
 * reviewed. The link-preview tags, on the other hand, are public, need nothing,
 * and carry the counts: probed live, `og:description` reads
 * "165 Followers, 132 Following, 104 Posts - See Instagram photos and videos
 * from Bleichi Loveless (@bleichi_loveless)".
 */

import type { SocialAccount } from '../../../types/common.js';
import { defineEnricher } from '../shared.js';
import { parseCounts, parseDisplayName, readProfile, toAccount } from './open-graph.js';

const NAME = 'instagram-profile';

export const instagramProfile = defineEnricher({
  name: NAME,
  platform: 'instagram',
  // No credentials of any kind.
  isAvailable: () => true,
  async read(account: SocialAccount): Promise<Partial<SocialAccount> | null> {
    const handle = account.account?.trim().replace(/^@+/, '');
    if (!handle) return null;

    const og = await readProfile(`https://www.instagram.com/${encodeURIComponent(handle)}/`);
    // A handle nobody holds still answers 200 — with the application shell and
    // no tags at all — so absence is "there was no profile here", never a
    // status code. Requiring the name as well as the counts keeps a future
    // generic landing page from reading as a real account.
    if (!og?.description || parseDisplayName(og.title) === null) return null;

    const counts = parseCounts(og.description);
    if (counts.followers === undefined) return null;

    return toAccount(og, handle, counts, 'followers', 'posts');
  },
});
