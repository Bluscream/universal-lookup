// Universal Lookup API Response Types

export type LookupType =
  | 'ip'
  | 'domain'
  | 'tel'
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
  apk: 'e.g. com.google.android.youtube or Play Store URL',
  order: 'e.g. 305-1827771-7197161',
  status: 'all, or e.g. discord,xbox,playstation',
  auto: 'e.g. 8.8.8.8, google.com, +49123..., user@..., 0034..., SteamID..., com.android...',
};

export const LOOKUP_OPTIONS: { value: LookupType; label: string; icon: string }[] = [
  { value: 'ip', label: 'IP Address', icon: '🌍' },
  { value: 'domain', label: 'Domain Name', icon: '📡' },
  { value: 'tel', label: 'Phone Number', icon: '📞' },
  { value: 'email', label: 'Email', icon: '📧' },
  { value: 'location', label: 'Location', icon: '📍' },
  { value: 'parcel', label: 'Parcel', icon: '📦' },
  { value: 'shipment', label: 'Shipment', icon: '🚚' },
  { value: 'web', label: 'Web Search', icon: '🔍' },
  { value: 'steam', label: 'Steam', icon: '🎮' },
  { value: 'url', label: 'URL / Domain', icon: '🌐' },
  { value: 'apk', label: 'App Package', icon: '📱' },
  { value: 'order', label: 'Order', icon: '📦' },
  { value: 'status', label: 'Service Status', icon: '🚦' },
  { value: 'auto', label: 'Auto Detect', icon: '✨' },
];
