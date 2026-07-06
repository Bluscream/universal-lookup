/** Supported lookup types */
export type LookupType =
  | 'tel'
  | 'ip'
  | 'domain'
  | 'email'
  | 'location'
  | 'parcel'
  | 'shipment'
  | 'web'
  | 'steam'
  | 'url'
  | 'apk'
  | 'order'
  | 'status'
  | 'auto';

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

/** Canonical health indicator across all status providers. */
export type StatusIndicator =
  | 'none'
  | 'minor'
  | 'major'
  | 'critical'
  | 'maintenance'
  | 'unknown';

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
  /**
   * Upstream data origin that produced this entry. Usually equal to `service`,
   * but differs when one provider feed splits into several services (e.g. both
   * `steam` and `cs2` have `source: "steam"`, sharing the Steam Web API).
   */
  source: string;
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

/** Provider function interface */
export interface Provider {
  name: string;
  lookup(
    query: string,
    type?: LookupType,
    originalQuery?: string,
    options?: { postalCode?: string },
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
