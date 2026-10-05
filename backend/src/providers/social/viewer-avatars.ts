/**
 * Fills in the viewer avatars a chat message does not carry.
 *
 * Synchra puts `viewer_profile_picture_url` on a message for some platforms and
 * leaves it null for others — a TikTok message arrives with a picture, a Twitch
 * or YouTube one does not — so a chat log rendered straight from the API shows
 * avatars for some people and blanks for the rest. The picture does exist;
 * `GET /channels/{id}/viewers/{provider}/{id}/info` has it for all of them. It
 * just costs a request per viewer, which is why this is a separate step.
 *
 * Ported from `Synchra\Presentation\ViewerAvatars` in synchra-php, including the
 * two things that keep a forty-message log from becoming forty requests:
 *
 *   - answers are cached **per viewer, not per message**, and a miss is cached
 *     too, so a chatter who talks thirty times is looked up once and a token
 *     that cannot read viewers is asked once rather than thirty times;
 *   - each call looks up only so many *unknown* viewers, so the cost of a cold
 *     start is spread over several lookups instead of landing on one.
 *
 * The endpoint needs a token that can read the channel's viewers. Without one it
 * answers 403, which is cached as a miss like any other — so a caller seeing no
 * Twitch avatars should check the token's scopes before assuming a bug.
 */

import type { ChatMessage } from 'synchra-ts';

/** How many viewers we have never seen before one call may look up. */
const LOOKUPS_PER_BATCH = 6;

/** How long an answer, including a miss, stays good. */
const TTL_MS = 60 * 60 * 1000;

interface Cached {
  url: string | null;
  at: number;
}

/**
 * Process-lifetime cache, keyed by platform and viewer id.
 *
 * Deliberately not keyed by channel: a viewer's avatar is a property of their
 * account on the platform, so the same person in two channels is one lookup.
 */
const cache = new Map<string, Cached>();

function key(provider: string, viewerId: string): string {
  return `${provider}:${viewerId}`;
}

/** Drop everything remembered. Used by the tests. */
export function resetViewerAvatars(): void {
  cache.clear();
}

/** The part of the Synchra client this needs, so a test can supply its own. */
export interface ViewerInfoSource {
  channelViewer: {
    providerViewerInfo(params: {
      channel_id: string;
      provider: string;
      provider_viewer_id: string;
    }): Promise<{ profile_picture_url?: string | null }>;
  };
}

/**
 * Avatar urls for the viewers in `messages`, keyed by `provider:viewer_id`.
 *
 * Messages that already carry a picture are recorded from the message itself
 * and never looked up. Everyone else is served from cache, and up to
 * LOOKUPS_PER_BATCH of the remainder are fetched.
 */
export async function viewerAvatars(
  synchra: ViewerInfoSource,
  channelId: string,
  messages: ChatMessage[],
): Promise<Map<string, string | null>> {
  const resolved = new Map<string, string | null>();
  // Keyed, not a list: a viewer who sent twelve messages must queue one lookup,
  // not twelve. Deduplicating only `resolved` missed this, because a viewer with
  // no cached answer is in neither map until the batch runs.
  const unknown = new Map<string, { provider: string; viewerId: string }>();

  for (const message of messages) {
    const viewerId = message.provider_viewer_id;
    if (!viewerId) continue;
    const id = key(message.provider, viewerId);
    if (resolved.has(id)) continue;

    // What the message carries is free and authoritative; prefer it always.
    const carried = message.viewer_profile_picture_url;
    if (carried) {
      resolved.set(id, carried);
      cache.set(id, { url: carried, at: Date.now() });
      continue;
    }

    const hit = cache.get(id);
    if (hit && Date.now() - hit.at < TTL_MS) {
      resolved.set(id, hit.url);
      continue;
    }

    unknown.set(id, { provider: message.provider, viewerId });
  }

  const batch = [...unknown.values()].slice(0, LOOKUPS_PER_BATCH);
  await Promise.all(
    batch.map(async ({ provider, viewerId }) => {
      const id = key(provider, viewerId);
      let url: string | null = null;
      try {
        const viewer = await synchra.channelViewer.providerViewerInfo({
          channel_id: channelId,
          provider,
          provider_viewer_id: viewerId,
        });
        url = viewer.profile_picture_url || null;
      } catch {
        // A token without viewer access, a viewer the channel has never seen, a
        // transport hiccup: all the same answer, and all worth remembering so
        // the next call does not repeat a request that cannot succeed.
        url = null;
      }
      cache.set(id, { url, at: Date.now() });
      resolved.set(id, url);
    }),
  );

  return resolved;
}
