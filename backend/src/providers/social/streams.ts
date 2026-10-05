/**
 * Past broadcasts for a Synchra channel.
 *
 * `GET /channels/{id}/streams` is **not** one of Synchra's public endpoints —
 * unlike providers and chat-messages, it answers 403 "You do not have access to
 * this channel" unless the token owns the channel. Probed against the live API,
 * this deployment's token reaches its own five channels and no others, so for
 * most lookups this contributes nothing and must do so quietly.
 *
 * What it gives for a channel it can reach is worth the call: when a broadcast
 * started, how long it ran, which platforms it went out to simultaneously, and
 * the viewer and chat statistics Synchra computed over it — none of which any
 * platform API here reports, because none of them can see a multi-platform
 * stream as one session.
 *
 * It is **not** a `Detailer`, and the reason is the shape of the data rather
 * than convenience: a detailer reads one platform account, while a session is a
 * property of the channel and spans several accounts at once. Filing it under
 * one of them would either duplicate it or pick a winner arbitrarily. It keeps
 * the one property that mattered about the detailers — `isBlacklisted(NAME)` is
 * checked before any request, so an operator can switch it off by name.
 *
 * There is deliberately no live flag. The record has no `is_live` and no
 * `ended_at`, only a nullable `duration_seconds`, so "currently live" could only
 * be guessed at — and a guess about whether somebody is on air right now is
 * worse than no answer.
 */

import { isBlacklisted } from '../../lib/providers.js';
import type { SocialStream } from '../../types/common.js';

export const STREAMS_NAME = 'synchra-streams';

/** The part of the client this needs, so a test can supply its own. */
export interface StreamSource {
  channelStream: {
    getChannelStreams(params: { channel_id: string; per_page?: number }): Promise<{
      records?: StreamRecord[] | null;
    }>;
  };
}

interface StreamRecord {
  id?: string;
  started_at?: string;
  duration_seconds?: number | null;
  providers?: readonly string[] | null;
  avg_viewer_count?: number | null;
  peak_viewer_count?: number | null;
  viewer_watched_minutes?: number | null;
  chat_message_count?: number | null;
  unique_chatter_count?: number | null;
}

function toStream(record: StreamRecord): SocialStream {
  return {
    id: record.id ?? null,
    started_at: record.started_at ?? null,
    duration_seconds: record.duration_seconds ?? null,
    platforms: record.providers ? [...record.providers] : null,
    avg_viewers: record.avg_viewer_count ?? null,
    peak_viewers: record.peak_viewer_count ?? null,
    watched_minutes: record.viewer_watched_minutes ?? null,
    chat_messages: record.chat_message_count ?? null,
    unique_chatters: record.unique_chatter_count ?? null,
  };
}

/**
 * Recent broadcasts, or an empty list.
 *
 * Never throws. A 403 is the expected answer for any channel the token does not
 * own, and it means "not available here" rather than "something is wrong" — so
 * it must not surface as an error that makes an otherwise complete lookup look
 * broken.
 */
export async function recentStreams(
  synchra: StreamSource,
  channelId: string,
  limit: number,
): Promise<SocialStream[]> {
  if (isBlacklisted(STREAMS_NAME)) return [];
  try {
    const page = await synchra.channelStream.getChannelStreams({
      channel_id: channelId,
      per_page: limit,
    });
    return (page.records ?? []).map(toStream);
  } catch {
    return [];
  }
}
