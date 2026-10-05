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
 *   - with SYNCHRA_TOKEN: search by name, then read providers and chat.
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
function toChatMessage(message: ChatMessage): SocialChatMessage {
  const parts = [...(message.message_parts ?? []), ...(message.notice_message_parts ?? [])];
  return {
    platform: canonicalPlatform(message.provider),
    channel: message.source_provider_channel_name ?? message.provider_channel_id ?? null,
    author: message.viewer_display_name ?? null,
    text: parts.map((part) => part.text).join('') || null,
    time: message.created_at ?? null,
    type: message.type,
    sub_type: message.sub_type ?? null,
  };
}

/**
 * The channel id for a query, or null when there is no way to find one.
 *
 * A uuid is taken at face value rather than searched for: the search needs a
 * scope the query does not, and `getChannelProviders` answers for any id.
 */
async function resolveChannelId(synchra: Synchra, handle: string): Promise<string | null> {
  if (UUID.test(handle)) return handle;
  if (!config.synchraToken) return null;

  // By Synchra channel name first, then by the name on a connected platform —
  // someone known by their Twitch handle need not have used it as their
  // channel name.
  const byName = await synchra.channel.getChannels({ name: handle, per_page: 5 });
  const direct = byName.records?.[0]?.id;
  if (direct) return direct;

  const byProvider = await synchra.channel.getChannels({
    provider_channel_name: handle,
    per_page: 5,
  });
  return byProvider.records?.[0]?.id ?? null;
}

async function lookup(
  query: string,
  _type?: LookupType,
  _originalQuery?: string,
): Promise<ProviderResult<DiscoveryData>> {
  const start = Date.now();
  const handle = normalizeHandle(query);

  try {
    const synchra = client();
    const channelId = await resolveChannelId(synchra, handle);
    if (!channelId) {
      return {
        provider: NAME,
        success: false,
        data: {},
        error: 'SYNCHRA_TOKEN is not set, so a name cannot be resolved to a channel',
        duration: Date.now() - start,
      };
    }

    // Both are public and independent, so they go together rather than in
    // sequence. A failed chat read must not lose the accounts, which is why it
    // is settled rather than awaited directly.
    const [providers, chat] = await Promise.all([
      synchra.channelProvider.getChannelProviders({ channel_id: channelId }),
      synchra.chat
        .getChatMessages({ channel_id: channelId, per_page: config.socialChatLimit })
        .then((page) => page.records ?? [])
        .catch(() => [] as ChatMessage[]),
    ]);

    const accounts = providers
      .map(toAccount)
      .filter((account): account is SocialAccount => account !== null);

    const result = discovered(NAME, start, handle, accounts, channelId, { providers, chat });
    // Chat rides along even when no account was connected: a channel with chat
    // and no linked providers is unusual but not a miss.
    if (chat.length > 0) {
      return {
        ...result,
        success: true,
        error: undefined,
        data: { ...result.data, recent_chat: chat.map(toChatMessage) },
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
