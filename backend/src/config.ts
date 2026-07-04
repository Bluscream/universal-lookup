import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as dotenv from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../../.env') });

export const API_PREFIX = '/api/v1';

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
  port: envInt('PORT', 24011),
  host: env('HOST', '0.0.0.0'),
  logLevel: env('LOG_LEVEL', 'info'),

  // Cache
  dbPath: env('DB_PATH', './data/cache.db'),
  cacheTtl: envInt('CACHE_TTL', 86400), // 24 hours
  cacheTtlParcel: envInt('CACHE_TTL_PARCEL', 3600), // 1 hour
  cacheTtlStatus: envInt('CACHE_TTL_STATUS', 120), // 2 minutes (service health changes fast)

  // Timeouts
  clientTimeout: envInt('CLIENT_TIMEOUT', 5000),
  serverTimeout: envInt('SERVER_TIMEOUT', 30000),
  puppeteerTimeout: envInt('PUPPETEER_TIMEOUT', 10000),

  // API Keys
  ipApiComKey: env('IP_API_COM_KEY'),
  ipApiIoKey: env('IP_API_IO_KEY'),
  tellowsApiKey: env('TELLOWS_API_KEY'),
  maxmindLicenseKey: env('MAXMIND_LICENSE_KEY'),
  maxmindDbPath: env('MAXMIND_DB_PATH', './data/maxmind'),
  googleApiKey: env('GOOGLE_API_KEY'),
  googleSearchCx: env('GOOGLE_SEARCH_CX'),
  parcelsAppApiKey: env('PARCELSAPP_API_KEY'),
  dhlApiKey: env('DHL_API_KEY'),
  steamApiKey: env('STEAM_API_KEY'),
  virustotalApiKey: env('VIRUSTOTAL_API_KEY'),
  urlscanApiKey: env('URLSCAN_API_KEY'),
  backpackTfApiKey: env('BACKPACK_TF_API_KEY'),
  seventeenTrackApiKey: env('SEVENTEEN_TRACK_API_KEY'),
  amazonUsername: env('AMAZON_USERNAME'),
  amazonPassword: env('AMAZON_PASSWORD'),
  amazonTotpKey: env('AMAZON_TOTP_KEY'),
  amazonCookiesFile: env('AMAZON_COOKIES_FILE'),
  upsAccessKey: env('UPS_ACCESS_KEY'),
  uspsUsername: env('USPS_USERNAME'),
  fedexApiKey: env('FEDEX_API_KEY'),
  fedexSecretKey: env('FEDEX_SECRET_KEY'),
  aliexpressUsername: env('ALIEXPRESS_USERNAME'),
  aliexpressPassword: env('ALIEXPRESS_PASSWORD'),
  aliexpressCookiesFile: env('ALIEXPRESS_COOKIES_FILE'),
  aliexpressTotpKey: env('ALIEXPRESS_TOTP_KEY'),

  // FritzBox
  fritzboxHost: env('FRITZBOX_HOST', 'fritz.box'),
  fritzboxUser: env('FRITZBOX_USER'),
  fritzboxPass: env('FRITZBOX_PASS'),
  phoneCountryPrefix: env('PHONE_COUNTRY_PREFIX', '0049'),
  phoneLocalPrefix: env('PHONE_LOCAL_PREFIX'), // e.g. 6131
  get phoneLocalPrefixFull(): string {
    return `${this.phoneCountryPrefix}${this.phoneLocalPrefix}`;
  },

  // Puppeteer
  puppeteerSkipDownload: envBool('PUPPETEER_SKIP_DOWNLOAD', false),
  puppeteerExecutablePath: env('PUPPETEER_EXECUTABLE_PATH'),
  puppeteerArgs: env('PUPPETEER_ARGS'),

  // Providers configuration
  providersTel: env(
    'PROVIDERS_TEL',
    'emergency,fritzbox,tellows,dastelefonbuch,11880,dasoertliche,google,bing,duckduckgo,yahoo',
  ),
  providersIp: env(
    'PROVIDERS_IP',
    'ip-api.com,ip-api.io,ip-api.io/risk,maxmind,whois,dns,ping,traceroute,portscan,subdomain,google,bing,duckduckgo,yahoo',
  ),
  providersDomain: env('PROVIDERS_DOMAIN', 'whois,dns,subdomain,google,bing,duckduckgo,yahoo'),
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
    'dhl-web,dhl,amazon-tba,ups,usps,fedex,parcelsapp,pkge,17track,google,bing,duckduckgo,yahoo',
  ),
  providersShipment: env('PROVIDERS_SHIPMENT', 'amazon,google,bing,duckduckgo,yahoo'),
  providersWeb: env('PROVIDERS_WEB', 'google,bing,duckduckgo,yahoo'),
  providersSteam: env(
    'PROVIDERS_STEAM',
    'playerdb,steam-xml,steam-api,steam-inventory,backpack-tf,csfloat',
  ),
  providersUrl: env('PROVIDERS_URL', 'dns-lookup,ip-info,metadata,urlscan,virustotal'),
  providersOrder: env('PROVIDERS_ORDER', 'amazon'),
  providersStatus: env(
    'PROVIDERS_STATUS',
    'discord,vrchat,cloudflare,github,epic,reddit,twitch,xbox,playstation,activision,steam',
  ),

  // Status providers
  statusUserAgent: env(
    'STATUS_USER_AGENT',
    'Mozilla/5.0 (compatible; universal-lookup/1.0; +https://github.com/)',
  ),
  statusPsnRegion: env('STATUS_PSN_REGION', 'SCEA'), // SCEA=Americas, SCEE=Europe, SCEJ=Asia
  statusPsnCountry: env('STATUS_PSN_COUNTRY', 'US'),

  // Universal Search
  universalResultsLimit: envInt('UNIVERSAL_RESULTS_LIMIT', 3),

  // Auth & Feature Flags
  requireToken: env('REQUIRE_TOKEN'), // If set, require this token via ?token= or Authorization header
  disableRaw: envBool('DISABLE_RAW', false), // Disable ?raw query param
  disableFresh: envBool('DISABLE_FRESH', false), // Disable ?fresh query param
  disableWait: envBool('DISABLE_WAIT', false), // Disable ?wait query param

  // Rate Limiting (our API)
  rateLimitMax: envInt('RATE_LIMIT_MAX', 100), // Max requests per window
  rateLimitWindow: env('RATE_LIMIT_WINDOW', '1 minute'), // Time window
} as const;

/** Get the cache TTL for a given lookup type */
export function getCacheTtl(type: string): number {
  if (type === 'parcel' || type === 'shipment') return config.cacheTtlParcel;
  if (type === 'status') return config.cacheTtlStatus;
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
