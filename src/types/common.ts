/** Supported lookup types */
export type LookupType = 'tel' | 'ip' | 'email' | 'location' | 'parcel' | 'web';

export interface SearchResult {
  text: string;
  url: string;
  provider: string;
}

/** Result from a single provider */
export interface ProviderResult {
  /** Provider identifier (e.g. "ip-api.com", "tellows") */
  provider: string;
  /** Whether this provider succeeded */
  success: boolean;
  /** Normalized/mapped data fields */
  data: Record<string, unknown>;
  /** Raw API response (included if ?raw=true) */
  raw?: unknown;
  /** Error message if failed */
  error?: string;
  /** Time taken for this provider in milliseconds */
  duration: number;
}

/** The unified lookup response returned to clients */
export interface LookupResponse {
  /** Time the lookup took (human readable, e.g. "234ms") */
  lookup_time: string;
  /** Whether the overall lookup was successful (at least one provider succeeded) */
  success: boolean;
  /** Merged response data from all providers */
  response: Record<string, unknown>;
  /** Errors from failed providers: { provider_name: "error message" } */
  errors: Record<string, string>;
  /** Raw responses per provider (only if ?raw=true) */
  raw: Record<string, unknown>;
  /** Request metadata */
  request: {
    /** UTC time of the request */
    time: string;
    /** Parsed client IP */
    ip: string;
    /** Lookup type */
    type: LookupType;
    /** Final normalized query */
    query: string;
  };
}

/** Provider function interface — every provider module exports this */
export interface Provider {
  /** Unique provider name */
  name: string;
  /** Execute the lookup */
  lookup(query: string): Promise<ProviderResult>;
  /** Whether this provider is available (has required config/API keys) */
  isAvailable(): boolean;
}

/** Query parameters for lookup endpoints */
export interface LookupQueryParams {
  /** Include raw responses from each provider */
  raw?: boolean;
  /** Force fresh lookup, bypass cache */
  fresh?: boolean;
}

/** Cached lookup entry */
export interface CacheEntry {
  type: string;
  query: string;
  response: string; // JSON-serialized LookupResponse
  created_at: number; // Unix timestamp
  ttl: number; // TTL in seconds
}
