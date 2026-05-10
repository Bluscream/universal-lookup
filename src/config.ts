import 'dotenv/config';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

function env(key: string, fallback: string = ''): string {
  return process.env[key] ?? fallback;
}

function envInt(key: string, fallback: number): number {
  const val = process.env[key];
  if (!val) return fallback;
  const parsed = parseInt(val, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function envBool(key: string, fallback: boolean): boolean {
  const val = process.env[key];
  if (!val) return fallback;
  return val.toLowerCase() === 'true' || val === '1';
}

export const config = {
  // Server
  port: envInt('PORT', 24010),
  host: env('HOST', '0.0.0.0'),
  logLevel: env('LOG_LEVEL', 'info'),

  // Cache
  dbPath: env('DB_PATH', './data/cache.db'),
  cacheTtl: envInt('CACHE_TTL', 86400), // 24 hours
  cacheTtlParcel: envInt('CACHE_TTL_PARCEL', 3600), // 1 hour

  // Timeouts
  providerTimeout: envInt('PROVIDER_TIMEOUT', 10000),
  puppeteerTimeout: envInt('PUPPETEER_TIMEOUT', 15000),

  // API Keys
  ipApiComKey: env('IP_API_COM_KEY'),
  ipApiIoKey: env('IP_API_IO_KEY'),
  tellowsApiKey: env('TELLOWS_API_KEY'),
  maxmindLicenseKey: env('MAXMIND_LICENSE_KEY'),
  maxmindDbPath: env('MAXMIND_DB_PATH', './data/maxmind'),
  googleMapsApiKey: env('GOOGLE_MAPS_API_KEY'),
  parcelsAppApiKey: env('PARCELSAPP_API_KEY'),
  dhlApiKey: env('DHL_API_KEY'),

  // FritzBox
  fritzboxHost: env('FRITZBOX_HOST', 'fritz.box'),
  fritzboxUser: env('FRITZBOX_USER'),
  fritzboxPass: env('FRITZBOX_PASS'),
  phoneLocalPrefix: env('PHONE_LOCALPREFIX'), // e.g. 00496131

  // Puppeteer
  puppeteerSkipDownload: envBool('PUPPETEER_SKIP_DOWNLOAD', false),
  puppeteerExecutablePath: env('PUPPETEER_EXECUTABLE_PATH'),

  // Providers configuration
  providersTel: env(
    'PROVIDERS_TEL',
    'fritzbox,tellows,dastelefonbuch,11880,dasoertliche,google,bing,duckduckgo,yahoo',
  ),
  providersIp: env(
    'PROVIDERS_IP',
    'ip-api.com,ip-api.io,ip-api.io/risk,maxmind,whois,dns,ping,traceroute,portscan,subdomain,google,bing,duckduckgo,yahoo',
  ),
  providersEmail: env(
    'PROVIDERS_EMAIL',
    'dns,ip-api.io/email,ip-api.io/email-advanced,ip-api.io/risk,google,bing,duckduckgo,yahoo',
  ),
  providersLocation: env(
    'PROVIDERS_LOCATION',
    'nominatim,google-maps,google,bing,duckduckgo,yahoo',
  ),
  providersParcel: env(
    'PROVIDERS_PARCEL',
    'dhl-web,dhl,parcelsapp,google,bing,duckduckgo,yahoo',
  ),
  providersWeb: env(
    'PROVIDERS_WEB',
    'google,bing,duckduckgo,yahoo',
  ),

  // Universal Search
  universalResultsLimit: envInt('UNIVERSAL_RESULTS_LIMIT', 3),

  // Auth & Feature Flags
  requireToken: env('REQUIRE_TOKEN'), // If set, require this token via ?token= or Authorization header
  disableRaw: envBool('DISABLE_RAW', false), // Disable ?raw query param
  disableFresh: envBool('DISABLE_FRESH', false), // Disable ?fresh query param

  // Rate Limiting (our API)
  rateLimitMax: envInt('RATE_LIMIT_MAX', 100), // Max requests per window
  rateLimitWindow: env('RATE_LIMIT_WINDOW', '1 minute'), // Time window
} as const;

/** Get the cache TTL for a given lookup type */
export function getCacheTtl(type: string): number {
  if (type === 'parcel') return config.cacheTtlParcel;
  return config.cacheTtl;
}

/** Ensure the data directory exists */
export function ensureDataDir(): void {
  const dir = dirname(config.dbPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

export type Config = typeof config;
