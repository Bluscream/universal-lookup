/**
 * Supported lookup types. Single source of truth: the route matcher and the auth
 * hook both derive from this, so a new type cannot be added to one and missed by
 * the other.
 */
export const LOOKUP_TYPES = [
  'tel',
  'ip',
  'domain',
  'email',
  'location',
  'parcel',
  'shipment',
  'web',
  'steam',
  'url',
  'shorten',
  'apk',
  'app',
  'order',
  'status',
  'archive',
  'social',
  'auto',
] as const;

export type LookupType = (typeof LOOKUP_TYPES)[number];

export interface SearchResult {
  title: string;
  description: string;
  url: string;
  provider: string;
}

export interface TelData {
  phone?: string | null;
  phone_formatted?: string | null;
  name?: string | null;
  number_type?: string | null;
  tellows_score?: number | null;
  tellows_score_color?: string | null;
  caller_type?: string | null;
  caller_type_id?: number | null;
  city?: string | null;
  country?: string | null;
  comments_count?: number | null;
  searches_count?: number | null;
  assessment?: string | null;
  call_types?: Array<{ type: string; count: number }> | null;
  caller_names?: Array<{ name: string; count: number }> | null;
  last_call?: string | null;
  monthly_views?: number | null;
  blocklist_position?: number | null;
  area_name?: string | null;
  city_score?: number | null;
  area_code?: string | null;
  postal_code?: string | null;
  population?: number | null;
  provider?: string | null;
  comments?: Array<{ text: string; date?: string; score?: number; author?: string }> | null;
  street?: string | null;
  /**
   * Normalized 0-100 confidence that the number is spam, so providers using
   * different native scales still compare. PhoneBlock reports this directly;
   * tellows' 1-9 score is mapped onto it.
   */
  spam_score?: number | null;
  /** On the requesting user's personal block / allow list. */
  blocklisted?: boolean | null;
  whitelisted?: boolean | null;
  /** When the number was first and last reported (ISO 8601). */
  first_report?: string | null;
  last_report?: string | null;
  /** Calls from this number the provider has seen; a lifetime counter. */
  calls_count?: number | null;
  /** The requesting user's own note about the number, if they left one. */
  user_comment?: string | null;
  /** PhoneBlock rating code, A_LEGITIMATE (best) through G_FRAUD (worst). */
  phoneblock_rating?: string | null;
  /** Decay-aware spam-vote equivalent, ~4 month half-life. Not a raw count. */
  phoneblock_votes?: number | null;
  /** The same, for the surrounding number range. */
  phoneblock_votes_wildcard?: number | null;
  /** Recent-activity rate in reports per day, ~2 week half-life. */
  phoneblock_heat?: number | null;
  /** Documented as city or region; in practice usually the carrier. */
  phoneblock_location?: string | null;
  [key: string]: unknown;
}

export interface IpData {
  ip?: string | null;
  accuracy_radius?: number | null;
  as?: string | null;
  asn?: string | null;
  asn_org?: string | null;
  city?: string | null;
  continent?: string | null;
  continent_code?: string | null;
  country?: string | null;
  country_code?: string | null;
  currency?: string | null;
  hops?: Array<{ ip?: string | null; rtt_ms?: number | null }> | null;
  hosting?: boolean | null;
  isp?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  mobile?: boolean | null;
  network?: string | null;
  open_ports?: Array<{ port: number; service: string }> | null;
  org?: string | null;
  ping_alive?: boolean | null;
  ping_latency_ms?: number | null;
  ping_packet_loss?: number | null;
  postal_code?: string | null;
  proxy?: boolean | null;
  region?: string | null;
  region_code?: string | null;
  reverse_dns?: string | null;
  timezone?: string | null;
  utc_offset?: number | null;
  vpn?: boolean | null;
  tor?: boolean | null;
  datacenter?: boolean | null;
  crawler?: boolean | null;
  threat?: boolean | null;
  risk_score?: number | null;
  risk_level?: string | null;
  whois_cidr?: string | null;
  whois_country?: string | null;
  whois_netname?: string | null;
  whois_org?: string | null;
  [key: string]: unknown;
}

export interface DomainData {
  dns_a?: string[] | null;
  dns_aaaa?: string[] | null;
  dns_mx?: string[] | null;
  dns_ns?: string[] | null;
  dns_soa?: {
    admin_email?: string | null;
    expire?: number | null;
    min_ttl?: number | null;
    primary_ns?: string | null;
    refresh?: number | null;
    retry?: number | null;
    serial?: number | null;
  } | null;
  dns_txt?: string[] | null;
  subdomains?: string[] | null;
  whois_created?: string | null;
  whois_domain?: string | null;
  whois_nameservers?: string[] | null;
  whois_registrar?: string | null;
  whois_updated?: string | null;
  whois_expires?: string | null;
  whois_org?: string | null;
  [key: string]: unknown;
}

export interface EmailData {
  email?: string | null;
  email_username?: string | null;
  email_domain?: string | null;
  valid_syntax?: boolean | null;
  disposable?: boolean | null;
  free_provider?: boolean | null;
  role_account?: boolean | null;
  mx_records?: boolean | null;
  domain_exists?: boolean | null;
  domain_ips?: string[] | null;
  spf?: boolean | null;
  spf_record?: string | null;
  dmarc?: boolean | null;
  dmarc_record?: string | null;
  risk_score?: number | null;
  [key: string]: unknown;
}

/**
 * Canonical severity for a location warning, lowest to highest.
 *
 * DWD and NINA both publish the CAP severity vocabulary, so this is their own
 * scale rather than one invented here — which is why both can emit the shared
 * field instead of a `dwd_`/`nina_` prefixed one.
 */
export type WarningSeverity = 'unknown' | 'minor' | 'moderate' | 'severe' | 'extreme';

/**
 * One active warning for a place, from any warning provider.
 *
 * Providers append to the same `warnings` array, so a place covered by both a
 * weather warning and a civil-protection alert reports both in one list. `source`
 * is the provider that issued it.
 */
export interface LocationWarning {
  source: string;
  /** Event type as the issuer names it, e.g. "Sturmböen" or "Gefahreninformation". */
  event?: string | null;
  headline?: string | null;
  description?: string | null;
  /** What the issuer tells people to do. Empty for most weather warnings. */
  instruction?: string | null;
  severity?: WarningSeverity | null;
  /** CAP urgency: Immediate, Expected, Future, Past. */
  urgency?: string | null;
  /** Free-text area the warning covers, as the issuer describes it. */
  area?: string | null;
  start?: string | null;
  end?: string | null;
  url?: string | null;
}

/** Current conditions for a place. Units are in the field names. */
export interface LocationWeather {
  observed_at?: string | null;
  temperature_c?: number | null;
  apparent_temperature_c?: number | null;
  humidity_percent?: number | null;
  precipitation_mm?: number | null;
  cloud_cover_percent?: number | null;
  pressure_hpa?: number | null;
  wind_speed_kmh?: number | null;
  wind_gust_kmh?: number | null;
  wind_direction_deg?: number | null;
  /** Plain-language conditions, e.g. "Light rain". */
  condition?: string | null;
  source?: string | null;
}

export interface LocationData {
  name?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  country_code?: string | null;
  postal_code?: string | null;
  bounding_box?: string[] | null;
  display_name?: string | null;
  warnings?: LocationWarning[] | null;
  /** Highest severity across `warnings`, so a caller can triage without reading them. */
  warning_level?: WarningSeverity | null;
  weather?: LocationWeather | null;
  [key: string]: unknown;
}

export interface ParcelEvent {
  date: string;
  status: string;
  location?: string;
  courier?: string;
  source?: string | null;
}

export interface ParcelData {
  tracking_number?: string | null;
  couriers?: string[] | null;
  status?: string | null;
  status_code?: number | string | null;
  status_description?: string | null;
  delivered?: boolean | null;
  origin?: string | null;
  destination?: string | null;
  weight?: string | null;
  estimated_delivery?: string | null;
  days_in_transit?: string | null;
  events?: ParcelEvent[] | null;
  [key: string]: unknown;
}

export type ShipmentData = ParcelData;

export interface SteamData {
  steam_id_64?: string | null;
  username?: string | null;
  profile_url?: string | null;
  avatar_icon?: string | null;
  avatar_medium?: string | null;
  avatar_full?: string | null;
  avatar_url?: string | null;
  persona_state?: number | null;
  community_visibility_state?: number | null;
  last_logoff?: string | null;
  real_name?: string | null;
  primary_clan_id?: string | null;
  created_at?: string | null;
  country_code?: string | null;
  state_code?: string | null;
  city_id?: number | null;
  game_extrainfo?: string | null;
  game_id?: string | null;
  headline?: string | null;
  summary?: string | null;
  state_message?: string | null;
  privacy_state?: string | null;
  custom_url?: string | null;
  member_since?: string | null;
  community_banned?: boolean | null;
  vac_bans_count?: number | null;
  days_since_last_ban?: number | null;
  game_bans_count?: number | null;
  economy_ban_state?: string | null;
  game_count?: number | null;
  total_playtime_hours?: number | null;
  most_played_game?: {
    appid: number;
    name: string;
    playtime_hours: number;
  } | null;
  inventories?: Array<{
    app_id: number;
    game: string;
    item_count: number;
    sample_items?: string[];
    status: string;
  }> | null;
  total_inventory_items?: number | null;
  trade_ban_state?: string | null;
  csfloat_registered?: boolean | null;
  [key: string]: unknown;
}

/**
 * One short link, as created by one shortening service.
 *
 * Every service answers the same question, so every service fills the same
 * fields: a client must not have to know which one replied. Only what is
 * genuinely one service's own — a YOURLS keyword, its click counter — is
 * namespaced, and only where nothing else has an equivalent.
 */
export interface ShortLink {
  /** The shortening service, matching the provider name: yourls, is.gd, … */
  service: string;
  /** The created (or pre-existing) short URL. */
  short_url: string;
  /** The URL it points at, echoed back by the services that report it. */
  long_url?: string | null;
  /** Creation timestamp, ISO 8601, where the service reports one. */
  created?: string | null;
  /**
   * True when the service returned a link it already held for this URL rather
   * than creating a new one. Worth surfacing: shortening is a write, and
   * "nothing was created" is a different outcome from "a link was created".
   */
  existing?: boolean | null;
  /** The short code itself, where the service exposes it separately. */
  keyword?: string | null;
  /** Clicks so far; only the services that keep statistics report this. */
  clicks?: number | null;
  [key: string]: unknown;
}

export interface ShortenData {
  /** The URL that was shortened — the same for every provider in a lookup. */
  long_url?: string | null;
  /**
   * This provider's short URL. The merger keeps the first non-empty value, so
   * registry order decides which service owns the top-level field; YOURLS is
   * registered first, so a self-hosted instance wins over the public ones.
   */
  short_url?: string | null;
  /**
   * Every short link from every service that answered. The merger concatenates
   * arrays, so each provider contributes only its own entry and the merged
   * response carries the full list.
   */
  short_links?: ShortLink[] | null;
  [key: string]: unknown;
}

export interface UrlData {
  url?: string | null;
  title?: string | null;
  description?: string | null;
  server_ip?: string | null;
  dns_resolved?: string[] | null;
  ssl_valid?: boolean | null;
  ssl_subject?: string | null;
  ssl_issuer?: string | null;
  ssl_valid_to?: string | null;
  redirect_chain?: unknown[] | null;
  status_code?: number | null;
  risk_score?: number | null;
  threats?: string[] | null;
  [key: string]: unknown;
}

export interface ApkData {
  package_name?: string | null;
  title?: string | null;
  version?: string | null;
  developer?: string | null;
  developer_email?: string | null;
  score?: number | null;
  installs?: string | null;
  genre?: string | null;
  price?: string | number | null;
  is_free?: boolean | null;
  updated?: string | null;
  url?: string | null;
  icon?: string | null;
  downloads?: Array<{
    source: string;
    version?: string;
    url: string;
    size?: number;
    md5?: string;
    status?: number;
  }> | null;
  [key: string]: unknown;
}

/**
 * One software package, as one source knows it.
 *
 * The keys are deliberately shared across every source: a client asking "what
 * versions of firefox exist, and where" should not have to know that winget
 * calls it PackageIdentifier and Debian calls it a source package. Anything that
 * is genuinely one ecosystem's own scale is namespaced instead (`play_score`),
 * because merging it with another source's number would be meaningless.
 */
export interface AppEntry {
  /** Human-readable name, as the source presents it. */
  name: string;
  /** Which source answered — 'winget', 'flathub', 'aur', … Always set. */
  source: string;
  /** The identifier you would install with, in that source's own namespace. */
  id?: string | null;
  /** Latest version the source offers, as a string — versions are not numbers. */
  version?: string | null;
  description?: string | null;
  /** Canonical page for this package on the source. */
  url?: string | null;
  /** The software's own site, where the source records one. */
  homepage?: string | null;
  license?: string | null;
  publisher?: string | null;
  /** Last update, ISO 8601, when the source dates its packages. */
  updated?: string | null;
  icon?: string | null;
  /** Ready-to-paste install command, where the source has one. */
  install?: string | null;
  /** windows | linux | android | macos | cross-platform */
  platform?: string | null;
  /** Google Play's own 0-5 star rating. Not comparable to anything else. */
  play_score?: number | null;
  /** Google Play's install-count band, e.g. "1,000,000,000+". */
  play_installs?: string | null;
  [key: string]: unknown;
}

/** The app lookup's response: one combined list, from every source that answered. */
export interface AppData {
  apps?: AppEntry[] | null;
  [key: string]: unknown;
}

export interface WebResult {
  title: string;
  url: string;
  description?: string;
  provider: string;
}
export interface OrderShipment {
  tracking_url?: string;
  tracking_id?: string;
  item_id?: string;
  package_index?: string;
  [key: string]: unknown;
}

export interface OrderData {
  order_id?: string | null;
  status?: string | null;
  status_description?: string | null;
  total_price?: string | null;
  shipping_address?: string | null;
  items?: Array<{ name: string; url?: string }> | null;
  tracking_numbers?: string[] | null;
  shipments?: OrderShipment[] | null;
  [key: string]: unknown;
}

export interface WebData {
  web?: SearchResult[] | null;
  [key: string]: unknown;
}

/**
 * What one archival service knows about one URL.
 *
 * Every archive provider emits this same shape, so a client never has to know
 * which service answered: `service` names it, and every other field means the
 * same thing everywhere. Anything genuinely specific to one service stays in
 * that provider's `raw`, not here.
 */
export interface ArchiveSnapshot {
  /** The service that holds it — 'wayback', 'archive-today', … */
  service: string;
  /** Link to the archived copy. */
  snapshot_url: string;
  /** The URL that was archived, as the service recorded it. */
  original_url?: string | null;
  /** When the snapshot was taken, ISO 8601. */
  timestamp?: string | null;
  /** The HTTP status the archive recorded for the page it captured. */
  http_status?: number | null;
  /** True only when this very lookup created the snapshot. */
  saved_now?: boolean | null;
}

/**
 * What happened at one service, and whether it can be written to at all.
 *
 *   saved         this lookup published the URL to the service
 *   existing      the service already held a copy; nothing was published
 *   not-archived  the service answered, and has no copy
 *   read-only     the service has no save path we can use (see `note`)
 *   unconfigured  saving there needs credentials this deployment does not have
 */
export type ArchiveSaveState = 'saved' | 'existing' | 'not-archived' | 'read-only' | 'unconfigured';

/** One archival service's answer for a URL. */
export interface ArchiveServiceResult {
  service: string;
  status: ArchiveSaveState;
  /** Why the service could not be saved to, when that is the answer. */
  note?: string | null;
  snapshots?: ArchiveSnapshot[] | null;
}

export interface ArchiveData {
  original_url?: string | null;
  /**
   * Set to true by a provider that found or made a snapshot, and left unset
   * otherwise — the merger keeps the first non-empty value, so a provider with
   * nothing to report must stay silent rather than answer for the rest.
   */
  archived?: boolean | null;
  /** Whether this request asked for the URL to be published (`?save=true`). */
  save_requested?: boolean | null;
  snapshots?: ArchiveSnapshot[] | null;
  /**
   * Per-service outcome. Named `archives` rather than `services` because the
   * status lookup already owns `services` in the merged response with an
   * entirely different meaning, and there is one flat response namespace.
   */
  archives?: ArchiveServiceResult[] | null;
  [key: string]: unknown;
}

/**
 * One account on one platform, as the social lookup reports it.
 *
 * Two kinds of field live here and the difference matters. `platform`, `account`,
 * `account_id` and `url` come from whoever *claimed* the link — Keybase, Harbor
 * or Synchra — and are only as true as that source's verification. Everything
 * from `display_name` down is read afterwards from the platform itself and is
 * therefore current rather than claimed. `sources` and `verified_by` say which
 * is which, so a consumer can tell "Harbor says this is theirs, and the verifier
 * signed it" from "YouTube says this channel has 12k subscribers".
 */
export interface SocialAccount {
  /** Lowercase platform slug: 'youtube', 'x', 'github', 'twitch', … */
  platform: string;
  /** The handle, without a leading '@'. Unset when a source knows only an id. */
  account?: string | null;
  /** The platform's own stable id, where the claim or the platform carries one. */
  account_id?: string | null;
  /** Canonical profile URL. Taken from the claim when it has one. */
  url?: string | null;
  /** Which discovery sources claimed this account — 'keybase', 'harbor', … */
  sources: string[];
  /**
   * Identities that cryptographically vouched for the claim. Empty means nobody
   * did — the account is self-asserted, which is not the same as false.
   */
  verified_by?: string[] | null;

  // --- read from the platform, not from the claim ---
  display_name?: string | null;
  description?: string | null;
  avatar?: string | null;
  /** Followers, subscribers or equivalent. Named per platform in `metrics`. */
  followers?: number | null;
  /** Items published: videos, repos, posts. */
  uploads?: number | null;
  views?: number | null;
  /** Account creation, ISO 8601. */
  created_at?: string | null;
  /**
   * Platform-specific counts under their real names — `public_gists`,
   * `karma`, `broadcaster_type` — rather than forced into the fields above.
   */
  metrics?: Record<string, unknown> | null;
  /** The enricher that read the platform, when one did. */
  enriched_by?: string | null;
  /**
   * What this account has recently published, newest first.
   *
   * One shape for every platform on purpose: a video, a repository, a post and
   * a comment are all "a thing this account put out, at a time, with a score".
   * Keeping them uniform is what lets one list render them all and lets two
   * platforms be compared without the caller learning five schemas. Anything
   * genuinely platform-shaped goes in `metrics` on the entry, or in `details`.
   */
  activity?: SocialActivity[] | null;
  /**
   * Platform-shaped extras that are not a list of published things — a Twitch
   * stream schedule, the organisations a GitHub user belongs to — keyed by the
   * sub-provider that read them.
   */
  details?: Record<string, unknown> | null;
  /** Sub-providers that contributed `activity` or `details`. */
  detailed_by?: string[] | null;
  [key: string]: unknown;
}

/** One thing an account published. */
export interface SocialActivity {
  /** `video`, `clip`, `stream`, `repo`, `gist`, `post`, `comment`, `event`. */
  kind: string;
  /** The sub-provider that read it. */
  source: string;
  id?: string | null;
  title?: string | null;
  /** Body text, where the item is a post or a comment rather than a work. */
  text?: string | null;
  url?: string | null;
  /** Published at, ISO 8601. */
  time?: string | null;
  views?: number | null;
  /** Upvotes, stars, points — whatever the platform counts as approval. */
  score?: number | null;
  /** Seconds, for anything with a runtime. */
  duration?: number | null;
  /** Language, stars, flair, game — under the platform's own names. */
  metrics?: Record<string, unknown> | null;
}

/** A badge a platform shows beside a name. */
export interface SocialChatBadge {
  id?: string | null;
  name?: string | null;
  /** `subscriber`, `moderator`, `founder` — the platform's own grouping. */
  type?: string | null;
  icon?: string | null;
}

/** One chat message, as Synchra recorded it. */
export interface SocialChatMessage {
  /** Platform the message was sent on. */
  platform?: string | null;
  /** Synchra channel it belongs to. */
  channel?: string | null;
  /** Display name, as the platform shows it. */
  author?: string | null;
  /** The platform's own handle for them, which can differ from the display name. */
  author_name?: string | null;
  /** The platform's own id for them. */
  author_id?: string | null;
  /**
   * Their public profile page.
   *
   * Derived rather than reported: Synchra carries the handle and the id but no
   * url, since a url is a property of the platform. Null where the platform has
   * no public profile page — Discord, and the integrations that are not places
   * people have profiles at all.
   */
  author_url?: string | null;
  /**
   * Their avatar.
   *
   * Synchra puts `viewer_profile_picture_url` on a message for some platforms
   * and not others — TikTok messages carry one, Twitch and YouTube do not — so
   * this is filled from the message where present and resolved per viewer
   * otherwise. Null means neither route produced one.
   */
  author_avatar?: string | null;
  /** The colour the platform shows their name in, as the platform reports it. */
  author_color?: string | null;
  /** When they first appeared on this channel, ISO 8601. */
  author_since?: string | null;
  /** Subscriber, moderator, founder — whatever the platform badges them with. */
  badges?: SocialChatBadge[] | null;
  /**
   * Synchra's own standing for them, as a number.
   *
   * Passed through rather than labelled. Synchra's schema defines these as bare
   * values (0, 1, 2, 7, 8, 100, 200, 500, 1000) with no names — synchra-php
   * generates them as `N7`, `N100` and so on for the same reason — so any
   * mapping to "moderator" or "broadcaster" here would be this codebase
   * guessing, and a wrong guess about who moderates a channel is worse than an
   * unlabelled number. `badges` carries the human-readable standing.
   */
  access_level?: number | null;
  /** The message this one replies to, flattened. */
  reply_to?: { author?: string | null; text?: string | null } | null;
  /** Set when the message was removed, with who removed it if known. */
  deleted_at?: string | null;
  deleted_by?: string | null;
  text?: string | null;
  /** ISO 8601. */
  time?: string | null;
  [key: string]: unknown;
}

/** The social lookup's response. */
export interface SocialData {
  /**
   * Every account found, grouped by platform. One platform can hold several
   * accounts — a person with two YouTube channels is the case this lookup
   * exists for — so every value is a list even when it holds one entry.
   */
  accounts?: Record<string, SocialAccount[]> | null;
  /**
   * The identity each discovery source resolved the query to, as
   * '<source>:<identity>'. What the accounts below were derived from.
   */
  identities?: string[] | null;
  /** Recent chat, from Synchra, when the query resolved to a channel there. */
  recent_chat?: SocialChatMessage[] | null;
  /**
   * Past stream sessions, from Synchra.
   *
   * Top-level rather than under an account, because a session is a property of
   * the *channel*: one broadcast goes out to several platforms at once, and
   * `platforms` on each entry says which. Filing it under one of them would
   * either duplicate it or pick a winner arbitrarily.
   */
  streams?: SocialStream[] | null;
  [key: string]: unknown;
}

/**
 * One past broadcast, as Synchra recorded it.
 *
 * Deliberately carries no live flag. Synchra's stream record has no `is_live`
 * and no `ended_at` — only a nullable `duration_seconds` — so "currently live"
 * could only be inferred, and an unverified inference about whether somebody is
 * on air right now is worse than not answering.
 */
export interface SocialStream {
  id?: string | null;
  /** ISO 8601. */
  started_at?: string | null;
  duration_seconds?: number | null;
  /** Every platform this one broadcast went out to. */
  platforms?: string[] | null;
  avg_viewers?: number | null;
  peak_viewers?: number | null;
  watched_minutes?: number | null;
  chat_messages?: number | null;
  unique_chatters?: number | null;
}

/** Canonical health indicator across all status providers. */
export type StatusIndicator = 'none' | 'minor' | 'major' | 'critical' | 'maintenance' | 'unknown';

/** One service's current health, contributed by a single status provider. */
export interface StatusServiceEntry {
  service: string;
  name: string;
  indicator: StatusIndicator;
  status: string;
  operational: boolean;
  updated_at?: string | null;
  page_url?: string | null;
  /** CDN URL of the service's brand icon (for API consumers). */
  icon?: string | null;
  /** Category for grouping (Cloud / Games / Web / Other). */
  category?: string | null;
  active_incidents?: number | null;
  maintenance: boolean;
  maintainance: boolean;
  status_color?: string | null;
  service_color?: string | null;
}

/** An active incident/disruption reported by a status provider. */
export interface StatusIncident {
  service: string;
  name: string;
  impact?: string | null;
  status?: string | null;
  url?: string | null;
  started_at?: string | null;
  updated_at?: string | null;
  scheduled_until?: string | null;
}

/**
 * Combined service-status response. Each provider emits a single-element
 * `services` array (and any active `incidents`); the merger concatenates them
 * across providers into one unified response.
 */
export interface StatusData {
  services?: StatusServiceEntry[] | null;
  incidents?: StatusIncident[] | null;
  [key: string]: unknown;
}

/** Result from a single provider */
export interface ProviderResult<T = Record<string, unknown>> {
  provider: string;
  success: boolean;
  data: T;
  raw?: unknown;
  error?: string;
  duration: number;
}

/** The unified lookup response returned to clients */
export interface LookupResponse {
  lookup_time: string;
  success: boolean;
  response: Record<string, unknown>;
  errors: Record<string, string>;
  raw: Record<string, unknown>;
  request: {
    time: string;
    ip: string;
    type: LookupType;
    query: string;
  };
}

export interface MaintenanceWindow {
  utcDay: number; // 0 = Sun, 1 = Mon, ..., 6 = Sat
  utcHourStart: number;
  utcHourEnd: number;
}

/**
 * Per-request options passed down to every provider.
 *
 * `save` is deliberately not a boolean that defaults to true: the archive
 * providers publish the query URL to a third-party public archive, which is an
 * outward-facing and irreversible act, so it happens only when the caller asked
 * for it with `?save=true`.
 */
export interface LookupOptions {
  postalCode?: string;
  save?: boolean;
  /**
   * Deadline for this lookup's providers, overriding SERVER_TIMEOUT. Archiving
   * is the case that needs it: Save Page Now captures a page asynchronously and
   * routinely takes minutes, so the ordinary 30s ceiling would abandon a save
   * that is going to succeed — and abandoning it does not undo it.
   */
  timeoutMs?: number;
}

/** Provider function interface */
export interface Provider {
  name: string;
  lookup(
    query: string,
    type?: LookupType,
    originalQuery?: string,
    options?: LookupOptions,
  ): Promise<ProviderResult>;
  isAvailable(): boolean;
}

/** Query parameters for lookup endpoints */
export interface LookupQueryParams {
  raw?: boolean;
  fresh?: boolean;
}

/** Cached lookup entry */
export interface CacheEntry {
  type: string;
  query: string;
  response: string;
  created_at: number;
  ttl: number;
}
