import type { SocialAccount, SocialChatMessage } from '@universal-lookup/common';
import { ServiceLogo } from './ServiceLogo';

interface SocialCardProps {
  response: Record<string, unknown>;
}

/**
 * How an account came to be in the answer.
 *
 * This is the distinction the whole lookup turns on, so it is a visible badge
 * rather than a field buried in `metrics`. `claimed` means a source asserted the
 * link. The other two mean only that a handle exists on that platform, which two
 * unrelated people routinely do share.
 */
const MATCH_LABELS: Record<string, string> = {
  claimed: 'Claimed link',
  'exact-handle': 'Same handle',
  'search-result': 'Search match',
};

const MATCH_BADGES: Record<string, string> = {
  claimed: 'badge-success',
  'exact-handle': 'badge-warning',
  'search-result': 'badge-warning',
};

const PLATFORM_LABELS: Record<string, string> = {
  x: 'X / Twitter',
  hackernews: 'Hacker News',
  website: 'Websites',
  youtube: 'YouTube',
  tiktok: 'TikTok',
  github: 'GitHub',
};

function platformLabel(slug: string): string {
  return PLATFORM_LABELS[slug] ?? slug.charAt(0).toUpperCase() + slug.slice(1);
}

/** 1.2M rather than 1203481 — these are magnitudes, not quantities. */
function compact(value: number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return new Intl.NumberFormat(undefined, { notation: 'compact' }).format(value);
}

function formatTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const parsed = Date.parse(iso);
  return Number.isNaN(parsed) ? iso : new Date(parsed).toLocaleString();
}

/**
 * The counts a platform reported, as a single line.
 *
 * A null count is dropped rather than shown as zero — Twitch cannot report
 * followers to an app token and YouTube omits subscribers entirely when a
 * channel hides them, and both would otherwise read as "nobody follows them".
 */
function Counts({ account }: { account: SocialAccount }) {
  const parts: string[] = [];
  const followers = compact(account.followers);
  const uploads = compact(account.uploads);
  const views = compact(account.views);
  if (followers) parts.push(`${followers} followers`);
  if (uploads) parts.push(`${uploads} uploads`);
  if (views) parts.push(`${views} views`);
  if (account.created_at) parts.push(`since ${formatTime(account.created_at).split(',')[0]}`);

  if (parts.length === 0) return null;
  return <span className="social-counts">{parts.join(' · ')}</span>;
}

function AccountRow({ account }: { account: SocialAccount }) {
  const handle = account.account ?? account.account_id ?? '(unnamed)';
  const match = typeof account.metrics?.match === 'string' ? account.metrics.match : null;

  return (
    <div className="social-account">
      <div className="social-account-main">
        {account.avatar ? (
          <img className="social-avatar" src={account.avatar} alt="" loading="lazy" />
        ) : (
          <span className="social-avatar social-avatar-blank" aria-hidden />
        )}
        <div className="social-account-text">
          <div className="social-account-name">
            {account.url ? (
              <a href={account.url} target="_blank" rel="noopener noreferrer">
                {account.display_name || handle}
              </a>
            ) : (
              <strong>{account.display_name || handle}</strong>
            )}
            {account.display_name && account.account && (
              <span className="social-handle">@{account.account}</span>
            )}
          </div>
          {account.description && <p className="social-description">{account.description}</p>}
          <Counts account={account} />
        </div>
      </div>

      <div className="social-account-badges">
        {match && (
          <span className={`badge ${MATCH_BADGES[match] ?? 'tech-badge'}`}>
            {MATCH_LABELS[match] ?? match}
          </span>
        )}
        {/* Only `verified_by` survives into the response: who *claimed* a link
            and which reader confirmed it are internal to the pipeline now. A
            signature somebody else can check is a claim about the world and
            still worth showing. */}
        {account.verified_by && account.verified_by.length > 0 && (
          <span className="badge badge-success">verified by {account.verified_by.join(', ')}</span>
        )}
      </div>
    </div>
  );
}

function ChatLine({ message }: { message: SocialChatMessage }) {
  const author = message.author || message.author_name || 'someone';
  const badges = message.badges ?? [];
  return (
    <li className={`social-chat-line${message.deleted_at ? ' social-chat-deleted' : ''}`}>
      <span className="social-chat-meta">
        {message.platform && <ServiceLogo service={message.platform} size={13} />}
        <span className="social-chat-time">{formatTime(message.time)}</span>
      </span>
      {message.author_avatar ? (
        <img className="social-chat-avatar" src={message.author_avatar} alt="" loading="lazy" />
      ) : (
        <span className="social-chat-avatar social-chat-avatar-blank" aria-hidden />
      )}
      {/* The url is derived from the handle rather than reported by Synchra, so
          it is absent for platforms with no public profile page — Discord, and
          the integrations that are not places people have profiles at all. */}
      <span className="social-chat-who">
        {/* The platform's own name colour, which is how a regular reads a chat
            log at a glance. Only ever used as a colour, never as markup. */}
        {message.author_url ? (
          <a
            className="social-chat-author"
            href={message.author_url}
            target="_blank"
            rel="noopener noreferrer"
            style={message.author_color ? { color: message.author_color } : undefined}
          >
            {author}
          </a>
        ) : (
          <span
            className="social-chat-author"
            style={message.author_color ? { color: message.author_color } : undefined}
          >
            {author}
          </span>
        )}
        {badges.map((badge) =>
          badge.icon ? (
            <img
              key={badge.id ?? badge.name}
              className="social-chat-badge"
              src={badge.icon}
              alt={badge.name ?? ''}
              title={badge.name ?? undefined}
              loading="lazy"
            />
          ) : (
            <span key={badge.id ?? badge.name} className="social-chat-badge-text">
              {badge.name}
            </span>
          ),
        )}
      </span>
      <span className="social-chat-text">
        {message.reply_to && (
          <span className="social-chat-reply" title={message.reply_to.text ?? undefined}>
            ↳ {message.reply_to.author}
          </span>
        )}
        {message.text || <em>(no text)</em>}
        {message.deleted_at && (
          <span className="social-chat-removed">
            deleted{message.deleted_by ? ` by ${message.deleted_by}` : ''}
          </span>
        )}
      </span>
    </li>
  );
}

/**
 * One card per platform, plus the chat.
 *
 * Grouped by platform because that is the shape of the question — "which
 * accounts does this person have, and where" — and because a platform's counts
 * only make sense next to others from the same platform.
 */
export function SocialCard({ response }: SocialCardProps) {
  const accounts = (response.accounts ?? {}) as Record<string, SocialAccount[]>;
  const chat = (response.recent_chat ?? []) as SocialChatMessage[];
  const identities = (response.identities ?? []) as string[];
  const platforms = Object.entries(accounts).filter(([, list]) => list?.length > 0);
  const total = platforms.reduce((sum, [, list]) => sum + list.length, 0);

  if (platforms.length === 0 && chat.length === 0) return null;

  return (
    <>
      {platforms.map(([platform, list]) => (
        <div className="social-card" key={platform}>
          <div className="social-card-header">
            <ServiceLogo service={platform} size={18} />
            <h3 className="social-card-title">{platformLabel(platform)}</h3>
            {list.length > 1 && <span className="tech-badge">{list.length}</span>}
          </div>
          {list.map((account) => (
            <AccountRow
              key={`${account.account_id ?? ''}-${account.account ?? ''}-${account.url ?? ''}`}
              account={account}
            />
          ))}
        </div>
      ))}

      {platforms.length > 0 && (
        <div className="social-summary full-width">
          <span>
            {total} account{total === 1 ? '' : 's'} across {platforms.length} platform
            {platforms.length === 1 ? '' : 's'}
          </span>
          {identities.length > 0 && (
            <span className="social-identities">identified as {identities.join(', ')}</span>
          )}
        </div>
      )}

      {chat.length > 0 && (
        <div className="social-card full-width">
          <div className="social-card-header">
            <h3 className="social-card-title">Recent chat</h3>
            <span className="tech-badge">{chat.length}</span>
          </div>
          <ul className="social-chat">
            {chat.map((message, index) => (
              <ChatLine
                key={`${message.time ?? ''}-${message.author_id ?? index}`}
                message={message}
              />
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
