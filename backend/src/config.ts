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

/**
 * Why BIND_HOST and not HOST.
 *
 * Unraid's Tailscale container hook does `HOST=$(tailscale status --json | jq -r
 * '.Self.HostName')` and then execs the container's own command in that same
 * shell. Because the image exported HOST, that assignment overwrites the
 * *exported* value, so the app was handed `HOST=lookup` — a tailnet hostname.
 * Node resolved it through MagicDNS to an address belonging to another node and
 * the listen died with EADDRNOTAVAIL, which reads as an application crash with
 * nothing pointing at the real cause.
 *
 * HOST is too generic a name to own: any wrapper, hook or supervisor in the
 * process's ancestry may claim it. BIND_HOST is ours, so nothing else writes it.
 */
export const config = {
  // Server
  port: envInt('PORT', 24011),
  host: env('BIND_HOST', '0.0.0.0'),
  logLevel: env('LOG_LEVEL', 'info'),
  // Record every external process this service starts (headless Chromium and
  // its pages, ping, traceroute). On by default: these spawns are infrequent
  // relative to requests, and an unlogged one cost a production incident.
  logSpawns: envBool('LOG_SPAWNS', true),

  // Cache
  dbPath: env('DB_PATH', './data/cache.db'),
  cacheTtl: envInt('CACHE_TTL', 86400), // 24 hours
  cacheTtlParcel: envInt('CACHE_TTL_PARCEL', 3600), // 1 hour
  cacheTtlStatus: envInt('CACHE_TTL_STATUS', 120), // 2 minutes (service health changes fast)
  // A lookup where no provider succeeded is cached this long instead of the full
  // TTL, so a transient upstream outage cannot be served back for a day.
  cacheTtlFailure: envInt('CACHE_TTL_FAILURE', 60),

  // Timeouts
  clientTimeout: envInt('CLIENT_TIMEOUT', 5000),
  serverTimeout: envInt('SERVER_TIMEOUT', 30000),
  puppeteerTimeout: envInt('PUPPETEER_TIMEOUT', 10000),
  // Per-record ceiling for the DNS provider. Node's resolver has no deadline of
  // its own, so one record type that never answers used to hang the lookup.
  dnsTimeout: envInt('DNS_TIMEOUT', 5000),

  // API Keys
  ipApiComKey: env('IP_API_COM_KEY'),
  ipApiIoKey: env('IP_API_IO_KEY'),
  tellowsApiKey: env('TELLOWS_API_KEY'),
  phoneblockApiKey: env('PHONEBLOCK_API_KEY'),
  phoneblockUser: env('PHONEBLOCK_USER'),
  phoneblockPassword: env('PHONEBLOCK_PASSWORD'),
  maxmindLicenseKey: env('MAXMIND_LICENSE_KEY'),
  maxmindDbPath: env('MAXMIND_DB_PATH', './data/maxmind'),
  googleApiKey: env('GOOGLE_API_KEY'),
  // Base URL of a self-hosted SearXNG instance, e.g. https://search.example.com
  // or, from inside a Docker container talking to a SearXNG on the host,
  // http://172.17.0.1:28080 (the bridge gateway). Empty on purpose: no address
  // is right for everyone, and an unset value makes the provider report itself
  // as not configured instead of failing a connection on every search.
  searxngUrl: env('SEARXNG_URL'),
  searxngTimeout: envInt('SEARXNG_TIMEOUT', 10000),
  googleSearchCx: env('GOOGLE_SEARCH_CX'),
  parcelsAppApiKey: env('PARCELSAPP_API_KEY'),
  dhlApiKey: env('DHL_API_KEY'),
  steamApiKey: env('STEAM_API_KEY'),
  virustotalApiKey: env('VIRUSTOTAL_API_KEY'),
  urlscanApiKey: env('URLSCAN_API_KEY'),

  // YOURLS, the self-hosted shortener behind the /shorten/ lookup.
  //
  // Empty by default and empty in the repo: an instance is somebody's own
  // server, and its signature token is a credential that writes to it. Without
  // both a URL and one form of authentication the provider reports itself
  // unavailable rather than guessing at an endpoint.
  //
  // yourlsApiUrl points at the instance's yourls-api.php. The signature token
  // is the documented machine credential (Tools -> Secure passwordless API
  // requests); username/password is the fallback for an instance that has not
  // issued one.
  yourlsApiUrl: env('YOURLS_API_URL'),
  yourlsSignature: env('YOURLS_SIGNATURE'),
  yourlsUsername: env('YOURLS_USERNAME'),
  yourlsPassword: env('YOURLS_PASSWORD'),
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
  // Phonebooks to skip entirely, by name (comma-separated, case-insensitive
  // substring). A FRITZ!Box exposes its call-barring and spam-score lists as
  // phonebooks alongside real contacts, and they dominate the download while
  // holding nothing worth resolving a caller against — on one box the barring
  // list alone was 315 KB of a 360 KB total. Skipped before the book is
  // fetched, so the bytes are never transferred. Set to empty to fetch all.
  fritzboxSkipPhonebooks: env(
    'FRITZBOX_SKIP_PHONEBOOKS',
    'Blocklist,Call locks,Sperrliste,Tellows',
  ),
  // How long a downloaded phonebook is trusted without asking the box at all.
  // Kept short because revalidating is nearly free: phonebook.lua honours a
  // `timestamp` query parameter and answers an unchanged book with ~220 bytes
  // instead of the whole thing, so a new contact shows up within a minute
  // rather than within an hour.
  fritzboxPhonebookRevalidate: envInt('FRITZBOX_PHONEBOOK_REVALIDATE', 60),
  // Safety net: after this long a book is downloaded unconditionally, in case a
  // box ever reports a timestamp that does not move when its contents do.
  fritzboxPhonebookTtl: envInt('FRITZBOX_PHONEBOOK_TTL', 3600),
  phoneCountryPrefix: env('PHONE_COUNTRY_PREFIX', '0049'),
  phoneLocalPrefix: env('PHONE_LOCAL_PREFIX'), // e.g. 6131
  get phoneLocalPrefixFull(): string {
    return `${this.phoneCountryPrefix}${this.phoneLocalPrefix}`;
  },

  // Puppeteer
  puppeteerSkipDownload: envBool('PUPPETEER_SKIP_DOWNLOAD', false),
  puppeteerExecutablePath: env('PUPPETEER_EXECUTABLE_PATH'),
  puppeteerArgs: env('PUPPETEER_ARGS'),
  // Close the shared Chromium after this long with no use. 0 disables it and
  // keeps the old behaviour of one browser for the lifetime of the process.
  puppeteerIdleTimeout: envInt('PUPPETEER_IDLE_TIMEOUT', 120000),
  // When a navigation is considered done. 'networkidle2' waits for the network
  // to go quiet, which never happens on a page with ads, analytics or polling —
  // every allestörungen fetch timed out on it. Anything rendered after
  // DOMContentLoaded should be awaited with a selector instead.
  puppeteerWaitUntil: env('PUPPETEER_WAIT_UNTIL', 'domcontentloaded') as
    | 'load'
    | 'domcontentloaded'
    | 'networkidle0'
    | 'networkidle2',

  // Providers configuration
  //
  // One blacklist instead of thirteen allowlists. Entries turn things off and
  // are matched punctuation-insensitively; both levels live in the same list:
  //   - a lookup type ("web", "apk") disables that whole endpoint, and
  //   - a provider name ("steam-xml", "tellows") disables that one provider.
  // Empty (the default) means everything registered runs.
  providersBlacklist: env('PROVIDERS_BLACKLIST', ''),

  // App (software) lookup
  //
  // GitHub's repository search allows 10 unauthenticated requests a minute for
  // the whole host, which one busy /app/ lookup can exhaust. A token — any
  // classic or fine-grained token, no scopes needed for public search — raises
  // that to 30. Optional: without one the provider still runs and reports a rate
  // limit as a failure rather than as an empty result.
  githubToken: env('GITHUB_TOKEN', ''),
  // NixOS publishes no open package search API. search.nixos.org queries an
  // Elasticsearch cluster with a read-only account embedded in its frontend;
  // borrowing someone else's embedded credentials is not this service's call, so
  // point these at a cluster you are entitled to use. Empty (the default) makes
  // the nixpkgs provider report itself unconfigured instead of failing.
  // Example URL: https://search.nixos.org/backend/latest-43-nixos-unstable/_search
  nixpkgsSearchUrl: env('NIXPKGS_SEARCH_URL', ''),
  nixpkgsSearchUser: env('NIXPKGS_SEARCH_USER', ''),
  nixpkgsSearchPassword: env('NIXPKGS_SEARCH_PASSWORD', ''),

  // Social (linked accounts) lookup
  //
  // Keybase and Harbor need no credentials at all, so the lookup answers with
  // nothing configured. The settings below widen what it can see.
  //
  // Synchra: a personal access token from the Synchra dashboard. Reading a
  // channel's connected providers and its chat are both public, but *finding* a
  // channel by name needs the `channel:read` scope — so without a token the
  // Synchra source only works when the query is already a channel uuid, and says
  // so rather than failing silently.
  synchraToken: env('SYNCHRA_TOKEN', ''),
  // Only for a self-hosted or staging Synchra; empty uses the public API.
  synchraBaseUrl: env('SYNCHRA_BASE_URL', ''),
  // Twitch app credentials (not a user login). The client-credentials flow these
  // drive reads public channel data and nothing belonging to any account.
  // Register at https://dev.twitch.tv/console/apps. Without them the Twitch
  // enricher reports itself unconfigured and the claimed account is still
  // returned, just undescribed.
  twitchClientId: env('TWITCH_CLIENT_ID', ''),
  twitchClientSecret: env('TWITCH_CLIENT_SECRET', ''),
  // Reddit app credentials (type "script", from reddit.com/prefs/apps). Reddit
  // closed its anonymous JSON endpoints — every unauthenticated route answers
  // 403, and old.reddit.com answers 200 with an HTML interstitial — so the
  // Reddit enricher cannot work without these and reports itself unconfigured.
  redditClientId: env('REDDIT_CLIENT_ID', ''),
  redditClientSecret: env('REDDIT_CLIENT_SECRET', ''),
  // How many discovered accounts get read from their own platform. An identity
  // with forty claims would otherwise mean forty third-party requests for one
  // lookup; accounts past the cap are still returned, just not enriched.
  socialEnrichLimit: envInt('SOCIAL_ENRICH_LIMIT', 12),
  // How many recent chat messages to carry back from Synchra.
  socialChatLimit: envInt('SOCIAL_CHAT_LIMIT', 25),
  // Stop at the first source that knows the handle, rather than merging all of
  // them: Synchra, then Keybase, then Harbor, then the platforms themselves.
  //
  // The cost is measured, not theoretical. Looking up `Bluscream` with the
  // cascade off returns 10 accounts, because Keybase and Synchra each know 5
  // and they only partly overlap; with it on, Synchra answers first and the
  // Keybase proofs are never fetched. Set SOCIAL_CASCADE=false to query every
  // source and merge, which is slower and broader.
  socialCascade: envBool('SOCIAL_CASCADE', true),
  // Whether the chain's last rung — each platform's own user search, first hit
  // — runs when nothing else matched. Off by default: a fuzzy name match is not
  // evidence that the account belongs to the person being looked up, and it
  // spends a request on every searchable platform to say so.
  socialDirectSearch: envBool('SOCIAL_DIRECT_SEARCH', false),

  // Location providers
  //
  // The warning and weather providers geocode through Nominatim, whose usage
  // policy is 1 req/s, so the result is shared and cached for a day — a place's
  // coordinates do not move.
  locationGeocodeTtl: envInt('LOCATION_GEOCODE_TTL', 86400),
  locationWarningsEnabled: envBool('LOCATION_WARNINGS_ENABLED', true),
  locationWeatherEnabled: envBool('LOCATION_WEATHER_ENABLED', true),
  // German text where a warning carries both. DWD and NINA publish the German
  // original and a translation, and the German is the authoritative wording.
  locationWarningsGerman: envBool('LOCATION_WARNINGS_GERMAN', true),
  // How many NINA warnings to fetch full CAP detail for. Each is one request.
  locationNinaDetailLimit: envInt('LOCATION_NINA_DETAIL_LIMIT', 5),

  // Archive providers
  //
  // Saving publishes the queried URL to a public third-party archive and cannot
  // be undone, so it never happens on an ordinary lookup: the caller has to ask
  // with `?save=true`. ARCHIVE_SAVE_ENABLED is the operator's switch over that —
  // with it false, a save request is refused and only existing snapshots are
  // reported, which is the right default for an instance exposed to the world.
  archiveSaveEnabled: envBool('ARCHIVE_SAVE_ENABLED', true),
  // A Wayback save takes tens of seconds and the endpoint blocks a caller that
  // hammers it, so saves are serialized with this gap and given their own, much
  // longer deadline than SERVER_TIMEOUT. The same gap paces the Save Page Now
  // status polls, which are the same conversation with the same endpoint.
  archiveSaveTimeout: envInt('ARCHIVE_SAVE_TIMEOUT', 120000),
  archiveSaveMinGapMs: envInt('ARCHIVE_SAVE_MIN_GAP_MS', 5000),
  // archive.org S3-style keys, from https://archive.org/account/s3.php.
  // Save Page Now answers an anonymous request "You need to be logged in to use
  // Save Page Now" (HTTP 401), so these are not a rate-limit upgrade any more —
  // they are what makes saving to the Wayback Machine possible at all. Reading
  // existing snapshots needs no credentials.
  iaAccessKey: env('IA_ACCESS_KEY'),
  iaSecretKey: env('IA_SECRET_KEY'),
  // perma.cc API key, from a perma.cc account's settings page. Without it the
  // provider reports itself unavailable, like every other credentialed one.
  permaCcApiKey: env('PERMA_CC_API_KEY'),
  // Perma links are created inside a folder; empty means the account's default.
  permaCcFolderId: env('PERMA_CC_FOLDER_ID'),

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

  // allestörungen (crowd-sourced outage reports, Downdetector's German site).
  //
  // Off by default. Cloudflare serves every page on the Downdetector family of
  // domains an active JS challenge (`cf-mitigated: challenge`), which a real
  // headful browser was measured failing to clear — so neither the plain fetch
  // nor the headless escalation can ever return data, and the escalation costs
  // about a minute of Chromium CPU per service. On a container capped at 512 MB
  // and one core, a cold /status/all starved every other provider and took all
  // 37 down with it. The whole implementation is kept intact: set this to true
  // to bring it back if the site ever becomes reachable again. The supported
  // path is now the authenticated Downdetector API — see the block below.
  statusAllestoerungenEnabled: envBool('STATUS_ALLESTOERUNGEN_ENABLED', false),

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
  // Escalate to headless Chromium when plain HTTP is challenged.
  // Off by default: the challenge is a JS interstitial that a real headful
  // browser was measured failing to clear in 8s, so the escalation only ever
  // burns CPU. Only worth enabling if the site's protection changes.
  statusAllestoerungenUseBrowser: envBool('STATUS_ALLESTOERUNGEN_USE_BROWSER', false),
  // The browser escalation is the most expensive path in the service. When it
  // fails it fails for every page, so stop launching browsers after this many
  // consecutive failures and retry only after the cooldown.
  statusAllestoerungenBreakerThreshold: envInt('STATUS_ALLESTOERUNGEN_BREAKER_THRESHOLD', 3),
  statusAllestoerungenBreakerCooldown: envInt('STATUS_ALLESTOERUNGEN_BREAKER_COOLDOWN', 900), // 15 min
  // Downdetector API v2 (https://downdetectorapi.com/v2/docs/raw.html).
  //
  // The supported replacement for the allestörungen scrape: the same data, from
  // the vendor's own authenticated API, with no Cloudflare in the way. Requires
  // client credentials (a commercial Downdetector subscription) — without them
  // the provider reports itself unavailable and is skipped, exactly like every
  // other credentialed provider.
  downdetectorClientId: env('DOWNDETECTOR_CLIENT_ID', ''),
  downdetectorClientSecret: env('DOWNDETECTOR_CLIENT_SECRET', ''),
  downdetectorBaseUrl: env('DOWNDETECTOR_BASE_URL', 'https://downdetectorapi.com/v2'),
  // Same `slug=Label=icon=Category` spec as STATUS_ALLESTOERUNGEN_SERVICES, so
  // an existing service list can be moved across unchanged. Slugs are the ones
  // in a Downdetector URL (/status/<slug>/).
  downdetectorServices: env(
    'DOWNDETECTOR_SERVICES',
    'deutsche-telekom=Telekom=deutschetelekom,vodafone=Vodafone=vodafone,o2=o2=o2,1-und-1=1&1,deutsche-glasfaser=Deutsche Glasfaser,pyur=PYUR,netcologne=NetCologne,congstar=congstar==Internet',
  ),
  // Which Downdetector site the slugs belong to. Company ids are per-site, so
  // this scopes the slug lookup; `de` is allestörungen.
  downdetectorCountry: env('DOWNDETECTOR_COUNTRY', 'de'),
  // Tokens are JWTs valid for one hour; the vendor suggests refreshing five
  // minutes early, which is what this default does.
  downdetectorTokenTtl: envInt('DOWNDETECTOR_TOKEN_TTL', 3300), // 55 min
  // Company id and status caches. Ids effectively never change, so they are
  // held far longer than readings; the upstream only re-times every ~15 min.
  downdetectorCompanyTtl: envInt('DOWNDETECTOR_COMPANY_TTL', 86400), // 24 h
  downdetectorTtl: envInt('DOWNDETECTOR_TTL', 300), // 5 min
  // Reports in the last 15 minutes at or above which a service is called down,
  // used only when the API's own threshold verdict is unavailable.
  downdetectorMinReports: envInt('DOWNDETECTOR_MIN_REPORTS', 10),

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

/**
 * How long to keep a response, given whether anything actually answered.
 *
 * A lookup where every provider failed gets the short CACHE_TTL_FAILURE instead
 * of the type's full TTL. Caching a total failure for a day is how a /web/ lookup
 * came to keep reporting four timed-out engines as `17ms (cached)` long after the
 * engines recovered; not caching it at all would re-scrape every provider on
 * every request for a query that genuinely has no answer.
 */
export function getCacheTtlFor(type: string, success: boolean): number {
  return success ? getCacheTtl(type) : config.cacheTtlFailure;
}

/** Ensure the data directory exists */
export function ensureDataDir(): void {
  const dir = dirname(config.dbPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

export type Config = typeof config;
