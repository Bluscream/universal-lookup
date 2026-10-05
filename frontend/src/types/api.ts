// Universal Lookup API Response Types

/**
 * Re-exported from `common` rather than restated.
 *
 * This file used to hold its own copy of the list, and the copy fell behind:
 * `social` was added to the backend, served happily at `/api/social/:query`,
 * and never appeared in the UI's dropdown because the frontend did not know the
 * type existed. The only defence is to not have a second list, which is also
 * how `common` describes itself — the route matcher and the auth hook already
 * derive from it.
 */
import type { LookupType } from '@universal-lookup/common';

export type { LookupType };

export type StatusIndicator = 'none' | 'minor' | 'major' | 'critical' | 'maintenance' | 'unknown';

export interface StatusServiceEntry {
  service: string;
  name: string;
  indicator: StatusIndicator;
  status: string;
  operational: boolean;
  updated_at?: string | null;
  page_url?: string | null;
  icon?: string | null;
  category?: string | null;
  active_incidents?: number | null;
  maintenance: boolean;
  maintainance: boolean;
  status_color?: string | null;
  service_color?: string | null;
}

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

export interface LookupRequest {
  type: LookupType;
  query: string;
  raw?: boolean;
  fresh?: boolean;
  wait?: boolean;
}

/** One short link from one shortening service, as /shorten returns it. */
export interface ShortLink {
  service: string;
  short_url: string;
  long_url?: string | null;
  created?: string | null;
  existing?: boolean | null;
  keyword?: string | null;
  clicks?: number | null;
}

export interface LookupResponse {
  success: boolean;
  request?: {
    type: LookupType;
    query: string;
  };
  response?: Record<string, unknown>;
  errors?: Record<string, string>;
  lookup_time?: string;
}

// Parcel-specific types
export interface ParcelEvent {
  date: string;
  status?: string;
  description?: string;
  location?: string;
  source?: string;
  latitude?: number;
  longitude?: number;
}

export interface ParcelResponse {
  tracking_number: string;
  carrier?: string;
  status?: string;
  status_code?: string;
  status_description?: string;
  delivered?: boolean;
  origin?: string;
  destination?: string;
  weight?: string;
  estimated_delivery?: string;
  days_in_transit?: number;
  events?: ParcelEvent[];
  couriers?: string[];
  latitude?: number;
  longitude?: number;
}

// Steam-specific types
export interface SteamLinks {
  steam_community?: string;
  steam_db?: string;
  steam_rep?: string;
  backpack_tf?: string;
  csfloat?: string;
  steamid_finder?: string;
  steamhistory?: string;
  bansearch?: string;
  vaclist?: string;
}

export interface SteamInventory {
  app_id?: number;
  game: string;
  item_count: number;
  status: string;
  sample_items?: string[];
}

export interface MostPlayedGame {
  name: string;
  playtime_hours: number;
}

// URL-specific types
export interface RedirectStep {
  url: string;
  status: number;
}

export interface SslInfo {
  subject: string;
  subject_org?: string;
  issuer: string;
  issuer_org?: string;
  valid_from: string;
  valid_to: string;
  days_remaining: number;
  is_expired: boolean;
  serial_number: string;
  fingerprint: string;
}

export interface SecurityHeaders {
  content_security_policy?: string;
  strict_transport_security?: string;
  x_frame_options?: string;
  x_content_type_options?: string;
  x_xss_protection?: string;
  referrer_policy?: string;
}

// Web search types
export interface WebResult {
  title: string;
  url: string;
  description?: string;
  provider: string;
}

// Archive types
export interface ArchiveSnapshot {
  service: string;
  snapshot_url: string;
  original_url?: string;
  timestamp?: string;
  http_status?: number;
  saved_now?: boolean;
}

export type ArchiveSaveState = 'saved' | 'existing' | 'not-archived' | 'read-only' | 'unconfigured';

export interface ArchiveServiceResult {
  service: string;
  status: ArchiveSaveState;
  note?: string;
  snapshots?: ArchiveSnapshot[];
}

// APK download types
export interface ApkDownload {
  source: string;
  url: string;
  size?: number;
  status?: number;
}

export const PLACEHOLDERS: Record<LookupType, string> = {
  ip: 'e.g. 8.8.8.8',
  domain: 'e.g. google.com',
  tel: 'e.g. +493012345678',
  email: 'e.g. user@example.com',
  location: 'e.g. Berlin, Germany or 52.52,13.40',
  parcel: 'e.g. 00340434515310596216',
  shipment: 'e.g. Amazon progress tracker / ship-track URL',
  web: 'e.g. what is my ip, tellows 01756350071',
  steam: 'e.g. 76561197960287930 or steamcommunity.com/id/gabelogannewell',
  url: 'e.g. https://github.com or google.com',
  shorten: 'e.g. https://example.com/a/very/long/link — creates real short links',
  apk: 'e.g. com.google.android.youtube or Play Store URL',
  app: 'e.g. firefox, vlc, obs-studio — searched across every software repository',
  order: 'e.g. 305-1827771-7197161',
  status: 'all, or e.g. discord,xbox,playstation',
  archive: 'e.g. https://example.com — add ?save=true to publish it to an archive',
  social: 'e.g. @bleichi_loveless, Bluscream, or a pasted profile URL — the @ is optional',
  auto: 'e.g. 8.8.8.8, google.com, +49123..., user@..., 0034..., SteamID..., com.android...',
};

/**
 * How each lookup type is presented, in dropdown order.
 *
 * Typed as a complete `Record`, which is the whole point: adding a type to
 * `LOOKUP_TYPES` in `common` and forgetting it here is now a compile error
 * rather than a feature that silently never reaches the UI. Key order is
 * display order — chosen for the dropdown rather than copied from `common`,
 * since the most-used types belong at the top and `auto` at the bottom.
 */
const LOOKUP_LABELS: Record<LookupType, { label: string; icon: string }> = {
  ip: { label: 'IP Address', icon: '🌍' },
  domain: { label: 'Domain Name', icon: '📡' },
  tel: { label: 'Phone Number', icon: '📞' },
  email: { label: 'Email', icon: '📧' },
  location: { label: 'Location', icon: '📍' },
  parcel: { label: 'Parcel', icon: '📦' },
  shipment: { label: 'Shipment', icon: '🚚' },
  web: { label: 'Web Search', icon: '🔍' },
  steam: { label: 'Steam', icon: '🎮' },
  url: { label: 'URL / Domain', icon: '🌐' },
  shorten: { label: 'Shorten URL', icon: '✂️' },
  apk: { label: 'App Package', icon: '📱' },
  app: { label: 'Software', icon: '📦' },
  order: { label: 'Order', icon: '📦' },
  status: { label: 'Service Status', icon: '🚦' },
  archive: { label: 'Web Archives', icon: '🗄️' },
  social: { label: 'Social Accounts', icon: '👤' },
  auto: { label: 'Auto Detect', icon: '✨' },
};

export const LOOKUP_OPTIONS: { value: LookupType; label: string; icon: string }[] = (
  Object.entries(LOOKUP_LABELS) as [LookupType, { label: string; icon: string }][]
).map(([value, meta]) => ({ value, ...meta }));

/**
 * One software package as one source knows it. Mirrors AppEntry in common; the
 * keys are shared across every source on purpose, so the table below does not
 * have to know which one answered.
 */
export interface AppEntry {
  name: string;
  source: string;
  id?: string | null;
  version?: string | null;
  description?: string | null;
  url?: string | null;
  homepage?: string | null;
  license?: string | null;
  publisher?: string | null;
  updated?: string | null;
  icon?: string | null;
  install?: string | null;
  platform?: string | null;
}
