// Universal Lookup API Response Types

export type LookupType =
  | 'auto'
  | 'ip'
  | 'domain'
  | 'tel'
  | 'email'
  | 'location'
  | 'parcel'
  | 'steam'
  | 'url'
  | 'apk'
  | 'web';

export interface LookupRequest {
  type: LookupType;
  query: string;
  raw?: boolean;
  fresh?: boolean;
  wait?: boolean;
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

// APK download types
export interface ApkDownload {
  source: string;
  url: string;
  size?: number;
  status?: number;
}

export const PLACEHOLDERS: Record<LookupType, string> = {
  auto: 'e.g. 8.8.8.8, google.com, +49123..., user@..., 0034..., SteamID..., com.android...',
  ip: 'e.g. 8.8.8.8',
  domain: 'e.g. google.com',
  tel: 'e.g. +493012345678',
  email: 'e.g. user@example.com',
  location: 'e.g. Berlin, Germany or 52.52,13.40',
  parcel: 'e.g. 00340434515310596216',
  steam: 'e.g. 76561197960287930 or steamcommunity.com/id/gabelogannewell',
  url: 'e.g. https://github.com or google.com',
  apk: 'e.g. com.google.android.youtube or Play Store URL',
  web: 'e.g. what is my ip, tellows 01756350071',
};

export const LOOKUP_OPTIONS: { value: LookupType; label: string; icon: string }[] = [
  { value: 'auto', label: 'Auto Detect', icon: '✨' },
  { value: 'ip', label: 'IP Address', icon: '🌍' },
  { value: 'domain', label: 'Domain Name', icon: '📡' },
  { value: 'tel', label: 'Phone Number', icon: '📞' },
  { value: 'email', label: 'Email', icon: '📧' },
  { value: 'location', label: 'Location', icon: '📍' },
  { value: 'parcel', label: 'Parcel', icon: '📦' },
  { value: 'steam', label: 'Steam Profile', icon: '🎮' },
  { value: 'url', label: 'URL Scan & Info', icon: '🔗' },
  { value: 'apk', label: 'APK Packages', icon: '📦' },
  { value: 'web', label: 'Web Search', icon: '🔍' },
];
