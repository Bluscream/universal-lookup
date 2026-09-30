/**
 * Android sources: F-Droid, the IzzyOnDroid third-party F-Droid repo, and Google
 * Play.
 *
 * These overlap with the existing `apk` lookup, which stays as it is. The
 * difference is what they are for: `apk` answers "give me this package and
 * somewhere to download it from", these answer "which of the places software
 * comes from has this, and at what version".
 */

import * as cheerio from 'cheerio';
import gplay from 'google-play-scraper';
import type {
  AppData,
  AppEntry,
  LookupType,
  Provider,
  ProviderResult,
} from '../../types/common.js';
import { failure, get, getAllowing404, looksLikeAppId, result, toIso } from './shared.js';

/** An F-Droid-style repository's v1 packages endpoint: versions for one app id. */
interface FdroidPackages {
  packageName?: string;
  suggestedVersionCode?: string;
  packages?: Array<{ versionName?: string; versionCode?: string }>;
}

async function fdroidVersion(repoBase: string, appId: string): Promise<string | null> {
  const body = await getAllowing404<FdroidPackages>(
    `${repoBase}/api/v1/packages/${encodeURIComponent(appId)}`,
  );
  return body?.packages?.[0]?.versionName ?? null;
}

/** How many search hits get a version lookup of their own. */
const FDROID_VERSION_LOOKUPS = 6;

/**
 * F-Droid.
 *
 * The obvious source is the repository's `index-v2.json`, but that document is
 * 62 MB — downloading it to answer one query is not a trade this service can
 * make. So: the official search front-end for matching (it returns app id, name,
 * summary, licence and icon), and the repository's own v1 packages API for the
 * version of each match.
 */
export const fdroidProvider: Provider = {
  name: 'fdroid',
  isAvailable: () => true,
  async lookup(query: string, _type?: LookupType): Promise<ProviderResult<AppData>> {
    const start = Date.now();
    try {
      const html = await get<string>(
        `https://search.f-droid.org/?q=${encodeURIComponent(query)}&lang=en`,
        { responseType: 'text' },
      );
      const $ = cheerio.load(html);
      const hits = $('a.package-header');
      if (hits.length === 0 && $('form').length === 0) {
        throw new Error('F-Droid search returned an unrecognised page — layout changed?');
      }

      const found: AppEntry[] = [];
      hits.each((_, el) => {
        const anchor = $(el);
        const url = anchor.attr('href') ?? '';
        const appId = url.split('/packages/')[1]?.replace(/\/$/, '') ?? '';
        if (!appId) return;
        found.push({
          name: anchor.find('.package-name').text().trim() || appId,
          source: 'fdroid',
          id: appId,
          version: null,
          description: anchor.find('.package-summary').text().trim() || null,
          url,
          license: anchor.find('.package-license').text().trim() || null,
          icon: anchor.find('.package-icon').attr('src') ?? null,
          platform: 'android',
        });
      });

      await Promise.all(
        found.slice(0, FDROID_VERSION_LOOKUPS).map(async (app) => {
          app.version = await fdroidVersion('https://f-droid.org', String(app.id));
        }),
      );

      return result('fdroid', start, query, found, { hits: hits.length });
    } catch (error) {
      return failure('fdroid', start, error);
    }
  },
};

/**
 * IzzyOnDroid, the best-known third-party F-Droid repository.
 *
 * It publishes the same v1 packages API as F-Droid itself but no search — its
 * browser page ignores a search parameter — and its index is 15 MB. So this is
 * an exact-application-id source, which is exactly what checking for an update
 * of a known app needs, and it says so rather than returning nothing when handed
 * a plain word.
 */
export const izzyondroidProvider: Provider = {
  name: 'izzyondroid',
  isAvailable: () => true,
  async lookup(query: string, _type?: LookupType): Promise<ProviderResult<AppData>> {
    const start = Date.now();
    const appId = query.trim();
    if (!looksLikeAppId(appId)) {
      return {
        provider: 'izzyondroid',
        success: false,
        data: {},
        error: `"${query}" is not an Android application id — IzzyOnDroid has no search, only exact ids`,
        duration: Date.now() - start,
      };
    }

    try {
      const body = await getAllowing404<FdroidPackages & { error?: string }>(
        `https://apt.izzysoft.de/fdroid/api/v1/packages/${encodeURIComponent(appId)}`,
      );
      // The repo answers 200 with an {"error": …} body for an unknown package as
      // well as 404, depending on the path taken.
      if (!body || body.error || !body.packages?.length) {
        return {
          provider: 'izzyondroid',
          success: false,
          data: {},
          error: `No package "${appId}" in the IzzyOnDroid repository`,
          duration: Date.now() - start,
        };
      }

      const app: AppEntry = {
        name: body.packageName ?? appId,
        source: 'izzyondroid',
        id: body.packageName ?? appId,
        version: body.packages[0]?.versionName ?? null,
        url: `https://apt.izzysoft.de/fdroid/index/apk/${appId}`,
        platform: 'android',
        repository: 'IzzyOnDroid',
      };

      return result('izzyondroid', start, query, [app], body);
    } catch (error) {
      return failure('izzyondroid', start, error);
    }
  },
};

/** How many Play results are worth carrying into a combined list. */
const PLAY_RESULTS = 10;

/**
 * Google Play.
 *
 * Reuses `google-play-scraper`, already a dependency of the apk lookup. An
 * application id goes to the app endpoint (which carries the version), anything
 * else to search (which does not — Play only publishes a version on the app's
 * own page, and fetching ten of them per query is not worth it).
 */
export const googleplayProvider: Provider = {
  name: 'googleplay',
  isAvailable: () => true,
  async lookup(query: string, _type?: LookupType): Promise<ProviderResult<AppData>> {
    const start = Date.now();
    try {
      if (looksLikeAppId(query)) {
        const app = await gplay.app({ appId: query.trim() });
        return result('googleplay', start, query, [playEntry(app, app.version)], app);
      }

      const hits = await gplay.search({ term: query, num: PLAY_RESULTS });
      return result(
        'googleplay',
        start,
        query,
        hits.map((hit) => playEntry(hit, null)),
        { hits: hits.length },
      );
    } catch (error) {
      return failure('googleplay', start, error);
    }
  },
};

/** The subset of google-play-scraper's shape this provider reads. */
interface PlayApp {
  appId?: string;
  title?: string;
  summary?: string;
  description?: string;
  developer?: string;
  icon?: string;
  url?: string;
  score?: number;
  installs?: string;
  updated?: number;
}

function playEntry(app: PlayApp, version: string | null | undefined): AppEntry {
  const appId = app.appId ?? '';
  return {
    name: app.title ?? appId,
    source: 'googleplay',
    id: appId || null,
    version: version && version !== 'VARY' ? version : null,
    description: app.summary ?? app.description ?? null,
    url: app.url ?? `https://play.google.com/store/apps/details?id=${appId}`,
    publisher: app.developer ?? null,
    updated: toIso(app.updated),
    icon: app.icon ?? null,
    platform: 'android',
    play_score: app.score ?? null,
    play_installs: app.installs ?? null,
  };
}
