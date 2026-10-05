/**
 * Where a viewer's public profile lives on the platform they wrote from.
 *
 * Synchra identifies a viewer by the platform's own handle and id and carries no
 * public url, because a url is a property of the platform rather than of the
 * API — so building one is left to whoever renders the chat. This is that
 * mapping, ported from `Synchra\Presentation\ProfileUrl` in synchra-php, which
 * does the same job for the same data and is the reason the two render a chat
 * log identically.
 *
 * A platform that is not a place people have profiles — an emote host, a TTS
 * voice, an alert integration — returns null rather than a guess.
 */

/** Templates taking the viewer's handle. */
const BY_NAME: Record<string, string> = {
  twitch: 'https://www.twitch.tv/%s',
  tiktok: 'https://www.tiktok.com/@%s',
  kick: 'https://kick.com/%s',
  rumble: 'https://rumble.com/user/%s',
  x: 'https://x.com/%s',
};

/**
 * Platforms addressed by the platform's own id instead of the handle. YouTube's
 * canonical profile url is the channel id; the handle form exists but is not
 * what the API gives us.
 */
const BY_ID: Record<string, string> = {
  youtube: 'https://www.youtube.com/channel/%s',
};

/** The profile url for one viewer, or null when the platform has no public one. */
export function profileUrl(
  platform: string | null | undefined,
  viewerName: string | null | undefined,
  viewerId?: string | null,
): string | null {
  const slug = platform?.trim().toLowerCase();
  if (!slug) return null;

  const byId = BY_ID[slug];
  if (byId !== undefined) {
    return viewerId ? byId.replace('%s', encodeURIComponent(viewerId)) : null;
  }

  const byName = BY_NAME[slug];
  if (byName === undefined || !viewerName) return null;

  return byName.replace('%s', encodeURIComponent(viewerName));
}
