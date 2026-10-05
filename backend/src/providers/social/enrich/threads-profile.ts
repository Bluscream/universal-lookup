/**
 * Threads profile facts, from the profile page's Open Graph tags.
 *
 * Threads does have an official `profile_lookup`, and it is unusable here: under
 * standard access it resolves only Meta's own accounts (@meta, @threads,
 * @instagram, @facebook), real use needs App Review, and the target must have at
 * least 100 followers. The reverse-engineered clients are not an option either —
 * `threads-api` was archived after a Meta cease-and-desist in September 2023,
 * its final release tagged "The End".
 *
 * The link-preview tags need none of that. Probed live, `og:description` reads
 * "15 Followers • 18 Threads. See the latest conversations with
 * @bleichi_loveless".
 */

import type { SocialAccount } from '../../../types/common.js';
import { defineEnricher } from '../shared.js';
import { parseCounts, parseDisplayName, readProfile, toAccount } from './open-graph.js';

const NAME = 'threads-profile';

export const threadsProfile = defineEnricher({
  name: NAME,
  platform: 'threads',
  isAvailable: () => true,
  async read(account: SocialAccount): Promise<Partial<SocialAccount> | null> {
    const handle = account.account?.trim().replace(/^@+/, '');
    if (!handle) return null;

    const og = await readProfile(`https://www.threads.com/@${encodeURIComponent(handle)}`);
    // Threads is the more dangerous of the two: a handle nobody holds answers
    // 200 *with a full set of tags*, for the signed-out marketing page ("Join
    // Threads to share ideas, ask questions…"). Those tags have no `(@handle)`
    // in the title and no counts, which is what distinguishes them from a real
    // profile — a reader that trusted the tags' presence would report every
    // missing account as real.
    if (!og?.description || parseDisplayName(og.title) === null) return null;

    const counts = parseCounts(og.description);
    if (counts.followers === undefined) return null;

    return toAccount(og, handle, counts, 'followers', 'threads', NAME);
  },
});
