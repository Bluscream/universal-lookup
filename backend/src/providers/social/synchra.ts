/**
 * Synchra channels: their connected platform accounts, and their recent chat.
 *
 * Synchra is a streaming toolkit, so a channel there already holds exactly what
 * this lookup wants — the set of platform accounts one person streams to. It is
 * also the only source here that can answer the second half of the question,
 * because it stores the chat itself.
 *
 * The credential split is unusual and worth stating, since it decides what this
 * provider can do unconfigured. `GET /channels/{id}/providers` and
 * `GET /channels/{id}/chat-messages` are both public — verified, no token. But
 * *finding* a channel by name is `GET /channels`, which needs the
 * `channel:read` scope. So:
 *
 *   - with SYNCHRA_TOKEN: find the channel — by its own name, or by a handle on
 *     any platform it has connected — then read providers and chat.
 *   - without it, and the query is a channel uuid: skip the search and read
 *     both public endpoints anyway.
 *   - without it, and the query is a handle: report unconfigured, because there
 *     is no public way to turn a name into a channel id.
 *
 * The provider stays `isAvailable()` in the third case on purpose. "Configure a
 * token and this works" is an answer the caller should see in `errors`, and the
 * live probe is built to treat an unconfigured credential as a warning rather
 * than a failure.
 */

import {
  type ChannelProviderPublic,
  type ChatMessage,
  Synchra,
  type SynchraOptions,
} from 'synchra-ts';
import { config } from '../../config.js';
import type {
  LookupType,
  Provider,
  ProviderResult,
  SocialAccount,
  SocialChatMessage,
} from '../../types/common.js';
import { profileUrl } from './profile-url.js';
import { recentStreams } from './streams.js';
import { viewerAvatars } from './viewer-avatars.js';
import {
  canonicalPlatform,
  type DiscoveryData,
  discovered,
  failure,
  normalizeHandle,
} from './shared.js';

const NAME = 'synchra';

/** Platform connections that are not an account someone follows. */
const NOT_A_SOCIAL = new Set([
  '7tv',
  'betterttv',
  'frankerfacez',
  'streamelements',
  'streamlabs',
  'ttsmonster',
  'elevenlabs',
  'amazon_polly',
  'obs_remote',
]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function client(): Synchra {
  // Built as a literal because SynchraOptions is readonly throughout; an absent
  // baseUrl must be omitted rather than set to '', which would be a base url.
  const options: SynchraOptions = config.synchraBaseUrl ? { baseUrl: config.synchraBaseUrl } : {};
  // An anonymous client is a real, useful client here — both endpoints this
  // provider leans on answer without a token.
  return config.synchraToken
    ? Synchra.withToken(config.synchraToken, options)
    : Synchra.anonymous(options);
}

function toAccount(provider: ChannelProviderPublic): SocialAccount | null {
  if (NOT_A_SOCIAL.has(provider.provider)) return null;
  const account = provider.provider_channel_name ?? provider.provider_channel_display_name;
  if (!account && !provider.provider_channel_id) return null;
  return {
    platform: canonicalPlatform(provider.provider),
    account: account ?? null,
    account_id: provider.provider_channel_id ?? null,
    sources: [NAME],
    // Synchra knows the connection is real because the streamer authorised it
    // over OAuth, which is a stronger claim than a self-asserted link but is
    // not a signature anyone else can check. It is not reported as verified.
    verified_by: [],
    display_name: provider.provider_channel_display_name ?? null,
  };
}

/**
 * A chat message flattened to text.
 *
 * `message_parts` is empty for a notice — a gift, sub or raid — which puts its
 * content in `notice_message_parts` instead. Reading only the first would render
 * every gift as a blank line, so both are concatenated.
 */
function toChatMessage(message: ChatMessage, avatar?: string | null): SocialChatMessage {
  const parts = [...(message.message_parts ?? []), ...(message.notice_message_parts ?? [])];
  return {
    platform: canonicalPlatform(message.provider),
    channel: message.source_provider_channel_name ?? message.provider_channel_id ?? null,
    author: message.viewer_display_name ?? null,
    // The handle, kept beside the display name: they differ often enough, and
    // the handle is what the profile url is built from.
    author_name: message.viewer_name ?? null,
    author_id: message.provider_viewer_id ?? null,
    // Synchra does not send one, so it is derived — the same mapping
    // synchra-php applies when rendering the same data.
    author_url: profileUrl(message.provider, message.viewer_name, message.provider_viewer_id),
    // What the message carries wins; the resolver only fills the platforms that
    // send none.
    author_avatar: message.viewer_profile_picture_url ?? avatar ?? null,
    author_color: message.viewer_color ?? null,
    author_since: message.viewer_created_at ?? null,
    badges: (message.badges ?? []).map((badge) => ({
      id: badge.id,
      name: badge.name,
      type: badge.type,
      // `urls` holds three sizes; the largest that exists stays sharp on a
      // high-density display, and all of them are the platform's own CDN.
      icon: badge.urls?.lg ?? badge.urls?.md ?? badge.urls?.sm ?? null,
    })),
    access_level: message.access_level ?? null,
    reply_to: message.parent
      ? { author: message.parent.viewer_display_name, text: message.parent.message }
      : null,
    deleted_at: message.deleted_at ?? null,
    deleted_by: message.deleted_by_display_name ?? message.deleted_by_name ?? null,
    text: parts.map((part) => part.text).join('') || null,
    time: message.created_at ?? null,
    type: message.type,
    sub_type: message.sub_type ?? null,
  };
}

/**
 * The channel id for a query, or null when there is no way to find one.
 *
 * Three routes in, tried cheapest first.
 *
 * A uuid is taken at face value rather than searched for: `getChannelProviders`
 * answers for any id without a credential, so an id needs no search and no
 * scope. This is also the only way to reach a channel the token cannot list —
 * `getChannels` returns the channels its user has access to, which need not
 * include the one being asked about.
 *
 * A name goes through `getChannels({ name })`, whose match is server-side but
 * **loose**: probed against the live API, `name=blu` returns the channel
 * displayed as `Bluscream`. A substring hit is not an identification, so the
 * result is re-checked here against `display_name` for an exact,
 * case-insensitive equality. Without that a lookup for `blu` would silently
 * attach a different person's channels and chat to the answer.
 *
 * The third route is the one that matters most, and it was nearly missed.
 * `getChannels` accepts `provider_channel_name`, and on its own it is **ignored**
 * — probed with a value no channel could match, it returned every channel the
 * token can see, which is why this provider used to refuse to use it at all.
 * But paired with `provider` it works, and works *exactly*: probed live,
 * `{provider: 'twitch', provider_channel_name: 'bleichi_loveless'}` returns the
 * one channel, and a name no channel holds returns zero rows rather than
 * everything. That is the only route that answers the question this lookup is
 * actually asked — a handle on a platform, not a Synchra channel name — and it
 * is also the only one that reaches a channel the token cannot list.
 *
 * So a handle is tried against every platform Synchra federates. The providers
 * read is then checked against the handle before anything is published, because
 * the failure mode of a silently-ignored filter is to attach a stranger's
 * accounts and chat to the answer, and a parameter that was ignored once should
 * not be trusted on its own a second time.
 */

/** Every platform a Synchra channel can connect that someone could be named on. */
const PROVIDER_SLUGS = [
  'twitch',
  'youtube',
  'tiktok',
  'kick',
  'x',
  'rumble',
  'discord',
  'spotify',
  'owncast',
] as const;

export interface ChannelSearch {
  channel: {
    getChannels(params: {
      name?: string;
      provider?: (typeof PROVIDER_SLUGS)[number];
      provider_channel_name?: string;
      per_page?: number;
    }): Promise<{
      records?: Array<{ id: string; display_name?: string | null }> | null;
    }>;
  };
}

/**
 * Which route found the channel, because it decides what still needs checking.
 *
 * `uuid` was given rather than inferred. `name` was matched here, exactly,
 * against the channel's own display name. Only `provider` leaned on a
 * server-side filter, so only `provider` gets re-checked downstream.
 */
export type ChannelMatch = { id: string; route: 'uuid' | 'name' | 'provider' };

export async function resolveChannelId(
  synchra: ChannelSearch,
  handle: string,
): Promise<ChannelMatch | null> {
  if (UUID.test(handle)) return { id: handle, route: 'uuid' };

  const wanted = handle.toLowerCase();

  // A Synchra channel name first: one request, and it is the cheapest hit.
  const byName = await synchra.channel.getChannels({ name: handle, per_page: 25 });
  const exact = (byName.records ?? []).find(
    (channel) => channel.display_name?.trim().toLowerCase() === wanted,
  );
  if (exact) return { id: exact.id, route: 'name' };

  // Then the handle as a connected platform account, one platform at a time.
  // Sequential and short-circuiting: most handles hit on the first or second
  // platform, and nine concurrent requests per lookup is a poor trade for the
  // tail case.
  for (const provider of PROVIDER_SLUGS) {
    const page = await synchra.channel.getChannels({
      provider,
      provider_channel_name: handle,
      per_page: 5,
    });
    const records = page.records ?? [];
    // More than one channel claiming the same handle on the same platform means
    // the filter was not applied — the behaviour seen without `provider` — so
    // the result is discarded rather than guessed at.
    if (records.length === 1) {
      return { id: (records[0] as { id: string }).id, route: 'provider' };
    }
  }

  return null;
}

/**
 * Whether any account connected to this channel goes by `handle`.
 *
 * The display name counts as well as the account name: a channel found by its
 * Synchra name legitimately need not have a platform account spelled the same
 * way, and `resolveChannelId` already checked that name exactly.
 */
export function claims(
  providers: Array<{
    provider_channel_name?: string | null;
    provider_channel_display_name?: string | null;
  }>,
  handle: string,
): boolean {
  const wanted = handle.trim().toLowerCase();
  return providers.some((provider) =>
    [provider.provider_channel_name, provider.provider_channel_display_name].some(
      (name) => name?.trim().toLowerCase() === wanted,
    ),
  );
}

async function lookup(
  query: string,
  _type?: LookupType,
  _originalQuery?: string,
): Promise<ProviderResult<DiscoveryData>> {
  const start = Date.now();
  const handle = normalizeHandle(query);

  try {
    // A uuid needs no credential — the providers and chat endpoints are public
    // — so the token gate sits here rather than inside resolveChannelId, which
    // is about resolution only.
    const synchra = client();
    const match =
      UUID.test(handle) || config.synchraToken ? await resolveChannelId(synchra, handle) : null;
    if (!match) {
      return {
        provider: NAME,
        success: false,
        data: {},
        error: config.synchraToken
          ? `No Synchra channel for "${handle}" — tried it as a channel name and as an account name on every platform Synchra federates`
          : 'SYNCHRA_TOKEN is not set, so a name cannot be resolved to a channel',
        duration: Date.now() - start,
      };
    }

    // Both are public and independent, so they go together rather than in
    // sequence. A failed chat read must not lose the accounts, which is why it
    // is settled rather than awaited directly.
    const [providers, chat, streams] = await Promise.all([
      synchra.channelProvider.getChannelProviders({ channel_id: match.id }),
      synchra.chat
        .getChatMessages({ channel_id: match.id, per_page: config.socialChatLimit })
        .then((page) => page.records ?? [])
        .catch(() => [] as ChatMessage[]),
      // Follows the sub-provider switch, since like them it is an extra request
      // for context rather than part of answering "which accounts exist".
      config.socialDetails
        ? recentStreams(synchra, match.id, config.socialDetailLimit)
        : Promise.resolve([]),
    ]);

    // The resolution is confirmed here, against data that was fetched anyway.
    // A uuid needs no confirming — it was given, not inferred — but a handle
    // was matched by a server-side filter that is silently ignored in one of
    // its two forms, and a token that can list exactly one channel would see
    // that one channel returned for every query. If nothing on this channel
    // actually carries the handle, the match was spurious.
    if (match.route === 'provider' && !claims(providers, handle)) {
      return {
        provider: NAME,
        success: false,
        data: {},
        error: `Synchra returned a channel for "${handle}", but nothing on it carries that name — the match was discarded`,
        duration: Date.now() - start,
      };
    }

    const accounts = providers
      .map(toAccount)
      .filter((account): account is SocialAccount => account !== null);

    const result = discovered(NAME, start, handle, accounts, match.id, {
      providers,
      chat,
      streams,
    });
    if (streams.length > 0) result.data.streams = streams;
    // Chat rides along even when no account was connected: a channel with chat
    // and no linked providers is unusual but not a miss.
    if (chat.length > 0) {
      // Twitch and YouTube messages carry no avatar, so the ones that would
      // otherwise render blank are resolved per viewer — cached and rationed,
      // and allowed to fail, because a chat log without pictures is still a
      // chat log.
      const avatars = await viewerAvatars(synchra, match.id, chat).catch(
        () => new Map<string, string | null>(),
      );
      return {
        ...result,
        success: true,
        error: undefined,
        data: {
          ...result.data,
          recent_chat: chat.map((message) =>
            toChatMessage(
              message,
              avatars.get(`${message.provider}:${message.provider_viewer_id}`),
            ),
          ),
        },
      };
    }
    return result;
  } catch (error) {
    return failure(NAME, start, error);
  }
}

export const synchra: Provider = {
  name: NAME,
  lookup,
  // Available without a token — see the note at the top on what it can still do.
  isAvailable: () => true,
};
