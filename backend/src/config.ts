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
    'dns-email,ip-api.io/email,ip-api.io/email-advanced,ip-api.io/email-risk,google,bing,duckduckgo,yahoo',
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
    'playerdb,steam-xml,steam-api,steam-inventory,backpack-tf,csfloat,steam-db',
  ),
  providersUrl: env('PROVIDERS_URL', 'dns-lookup,ip-info,metadata,urlscan,virustotal'),
  providersOrder: env('PROVIDERS_ORDER', 'amazon,aliexpress'),
  providersStatus: env(
    'PROVIDERS_STATUS',
    'discord,vrchat,cloudflare,github,epic,reddit,twitch,xbox,playstation,activision,steam,ea,ubisoft,battlenet,nintendo,vercel,digitalocean,netlify,gcp,aws,azure,mongodb,sentry,bluesky,openai,claude,windsurf,devin',
  ),

  // Status providers
  statusUserAgent: env(
    'STATUS_USER_AGENT',
    'Mozilla/5.0 (compatible; universal-lookup/1.0; +https://github.com/)',
  ),
  // SCEA=Americas, SCEE=Europe, SCEJ=Asia. Also accepts a comma-separated list or
  // "all" (fetch every region). Default "all" for a global view.
  statusPsnRegion: env('STATUS_PSN_REGION', 'all'),
  // Empty / "all" / "global" = global overall status (any active issue anywhere
  // counts). A country code (e.g. US, DE) narrows the overall to that country;
  // incidents from other regions are still listed either way.
  statusPsnCountry: env('STATUS_PSN_COUNTRY', 'all'),
  // Ubisoft gameStatuses API: public app-id header + a comma-separated list of
  // application GUIDs to query (grab more from any game's /status page network tab).
  // Default = Rainbow Six Siege across PC/PS4/PS5/Xbox Series/Xbox One.
  statusUbisoftAppId: env('STATUS_UBISOFT_APP_ID', 'f612511e-58a2-4e9a-831f-61838b1950bb'),
  statusUbisoftAppIds: env(
    'STATUS_UBISOFT_APP_IDS',
    'e3d5ea9e-50bd-43b7-88bf-39794f4e3d40,fb4cc4c9-2063-461d-a1e8-84a7d36525fc,6e3c99c9-6c3f-43f4-b4f6-f1a3143f2764,76f580d5-7f50-47cc-bbc1-152d000bfe59,4008612d-3baf-49e4-957a-33066726a7bc',
  ),

  // Battle.net / Blizzard. With client credentials -> detailed WoW connected-realm
  // status; without -> reachability/latency approximation of the auth endpoint.
  blizzardClientId: env('BLIZZARD_CLIENT_ID'),
  blizzardClientSecret: env('BLIZZARD_CLIENT_SECRET'),
  statusBlizzardRegion: env('STATUS_BLIZZARD_REGION', 'us'), // us, eu, kr, tw
  statusBlizzardRealmSample: envInt('STATUS_BLIZZARD_REALM_SAMPLE', 3),
  statusBlizzardSlowMs: envInt('STATUS_BLIZZARD_SLOW_MS', 2500),

  // Nintendo netinfo locale (en_US, en_GB, ja_JP, …)
  statusNintendoLocale: env('STATUS_NINTENDO_LOCALE', 'en_US'),

  // allestörungen / Downdetector (crowd-sourced outage reports).
  //
  // Services that already have a provider are *enriched* with the crowd signal
  // (see CROWD_SLUGS) rather than duplicated. This list is for the ones nothing
  // else covers — German ISPs, banks, individual games. Comma-separated slugs
  // taken from the URL /en/status/<slug>/, each optionally `slug=Label=icon`.
  statusAllestoerungenServices: env(
    'STATUS_ALLESTOERUNGEN_SERVICES',
    // Fields are slug=Label=icon=Category. Telekom/Vodafone/o2 get Simple Icons
    // brand marks (matching the other providers); the rest aren't in Simple
    // Icons, so they fall back to the site's own logo automatically. congstar
    // carries no category upstream, so its category is pinned; the rest
    // normalize to "Internet" via CATEGORY_SLUGS.
    'deutsche-telekom=Telekom=deutschetelekom,vodafone=Vodafone=vodafone,o2=o2=o2,1-und-1=1&1,deutsche-glasfaser=Deutsche Glasfaser,pyur=PYUR,netcologne=NetCologne,congstar=congstar==Internet',
  ),
  // Override or disable the built-in service -> slug enrichment map, e.g.
  // "steam=steam,discord=" (an empty slug turns that service's enrichment off).
  statusAllestoerungenMap: env('STATUS_ALLESTOERUNGEN_MAP', ''),
  // The site flags a lot of services "warning" over a handful of reports, so by
  // default only a "danger" reading escalates an existing provider.
  statusAllestoerungenEscalateOnWarning: envBool(
    'STATUS_ALLESTOERUNGEN_ESCALATE_ON_WARNING',
    false,
  ),
  // Site to read from — any Downdetector locale works (downdetector.com,
  // downdetector.co.uk, …). Default is the German allestörungen.de (punycode).
  statusAllestoerungenDomain: env('STATUS_ALLESTOERUNGEN_DOMAIN', 'xn--allestrungen-9ib.de'),
  statusAllestoerungenLocale: env('STATUS_ALLESTOERUNGEN_LOCALE', 'en'),
  // Cloudflare challenges bursts, so requests are serialized with this gap and
  // cached for this long. The site itself only re-times every ~15 min.
  statusAllestoerungenMinGapMs: envInt('STATUS_ALLESTOERUNGEN_MIN_GAP_MS', 1500),
  statusAllestoerungenTtl: envInt('STATUS_ALLESTOERUNGEN_TTL', 300), // 5 min
  // Crowd-sourced noise floor: ignore an outage flag below this many reports,
  // and treat reports as elevated only above baseline * factor.
  statusAllestoerungenMinReports: envInt('STATUS_ALLESTOERUNGEN_MIN_REPORTS', 10),
  statusAllestoerungenFactor: envInt('STATUS_ALLESTOERUNGEN_FACTOR', 2),
  // Cloudflare rejects obvious bot agents outright.
  statusAllestoerungenUserAgent: env(
    'STATUS_ALLESTOERUNGEN_USER_AGENT',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  ),
  // Escalate to cloudscraper/headless Chromium when plain HTTP is challenged.
  // Turn off on deployments without Chromium available.
  statusAllestoerungenUseBrowser: envBool('STATUS_ALLESTOERUNGEN_USE_BROWSER', true),
  // Recurring maintenance windows injected as incidents while they're open.
  // Comma-separated `service:day:startHour-endHour[:Name]`, day 0=Sunday, hours
  // UTC — e.g. "steam:2:23-24:Weekly maintenance".
  statusMaintenanceWindows: env('STATUS_MAINTENANCE_WINDOWS', ''),
  // Semicolon-separated list of incident names to ignore across all status
  // providers (case-insensitive substring match). If every listed incident for a
  // service is ignored, that service is reported operational. Default hides some
  // perpetually-"impacted" legacy Activision titles.
  statusIgnored: env(
    'STATUS_IGNORED',
    'Crash Team Racing Nitro-Fueled — Xbox One;Crash Team Racing Nitro-Fueled — PlayStation 4;Crash Team Racing Nitro-Fueled — Nintendo Switch;Skylanders SuperChargers — Xbox 360;Workers AI experiencing degraded availability in some models',
  ),

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
