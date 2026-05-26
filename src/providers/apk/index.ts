import { getCacheTtl } from '../../config.js';
import { getCached, setCache } from '../../db/cache.js';
import { executeProvidersBackground, filterAndSortProviders, type DualPromiseResult } from '../../lib/providers.js';
import type { LookupType, Provider, ProviderResult } from '../../types/common.js';
import { getGooglePlayMetadata } from './subproviders/googleplay.js';
import { getAptoideDownload } from './subproviders/aptoide.js';
import { getApkmirrorDownload } from './subproviders/apkmirror.js';
import { getApkpureDownload } from './subproviders/apkpure.js';
import {
  getEvoziDownload,
  getApkComboDownload,
  getApkPremierDownload,
  getApkDlDownload,
  getApkSupportDownload,
} from './subproviders/other.js';
import type { ApkDownloadInfo } from './subproviders/aptoide.js';
import { parseApkFromUrl, } from './subproviders/parser.js';

const PROVIDER_NAME = 'apk';

/**
 * Normalizes an input query to an Android package name.
 * Handles full Google Play URLs and direct package names.
 */
export function extractPackageName(query: string): string {
  if (query.includes('play.google.com')) {
    try {
      const url = new URL(query);
      const id = url.searchParams.get('id');
      if (id) return id;
    } catch {
      // ignore
    }
  }
  return query.trim();
}

/**
 * APK Provider implementation
 */
export const apkProvider: Provider = {
  name: PROVIDER_NAME,
  isAvailable() {
    return true;
  },

  async lookup(query: string, _type?: LookupType): Promise<ProviderResult> {
    const start = Date.now();
    const pkg = extractPackageName(query);

    try {
      const metadata = await getGooglePlayMetadata(pkg);

      if (!metadata) {
        return {
          provider: PROVIDER_NAME,
          success: false,
          data: {},
          error: `App package ${pkg} not found on Google Play.`,
          duration: Date.now() - start,
        };
      }

      const results = await Promise.allSettled([
        getAptoideDownload(pkg),
        getApkmirrorDownload(pkg),
        getApkpureDownload(pkg),
        getEvoziDownload(pkg),
        getApkComboDownload(pkg),
        getApkPremierDownload(pkg),
        getApkDlDownload(pkg),
        getApkSupportDownload(pkg),
      ]);

      const downloads: ApkDownloadInfo[] = [];

      for (const result of results) {
        if (result.status === 'fulfilled') {
          downloads.push(...result.value);
        }
      }

      await Promise.allSettled(
        downloads.map(async (dl) => {
          try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);
            const res = await fetch(dl.url, { method: 'HEAD', signal: controller.signal });
            clearTimeout(timeoutId);
            
            dl.status = res.status;
            dl.is_alive = res.ok;
            
            if (!dl.size) {
              const contentLength = res.headers.get('content-length');
              if (contentLength) {
                dl.size = parseInt(contentLength, 10);
              }
            }
          } catch (_err) {
            dl.status = 0;
            dl.is_alive = false;
          }
        })
      );

      // Filter out invalid downloads and remove `is_alive`
      const validDownloads = downloads
        .filter(dl => dl.status && dl.status >= 200 && dl.status < 400)
        .map(dl => {
          const { is_alive, ...rest } = dl;
          return rest;
        });

      const validDownload = validDownloads.find(dl => dl.status === 200 && dl.size && dl.size > 0);
      if (validDownload) {
        // Run parsing entirely in the background so we don't block the provider response
        Promise.resolve().then(async () => {
          try {
            const parsedMetadata = await parseApkFromUrl(validDownload.url);
            // Wait briefly to ensure orchestrator has written the initial cache
            setTimeout(() => {
              const cached = getCached('apk', pkg);
              if (cached) {
                cached.response = {
                  ...cached.response,
                  ...parsedMetadata,
                };
                if (cached.raw?.apk) {
                  cached.raw.apk = {
                    ...cached.raw.apk,
                    ...parsedMetadata,
                  };
                }
                setCache('apk', pkg, cached, getCacheTtl('apk'));
                console.log(`[APK] Background parsing finished and cache updated for ${pkg}`);
              }
            }, 5000);
          } catch (err) {
            console.error(`[APK] Error parsing APK from ${validDownload.url} in background:`, err);
          }
        });
      }

      const data: Record<string, unknown> = {
        package_name: pkg,
        title: metadata.title,
        version: metadata.version,
        developer: metadata.developer,
        developer_email: metadata.developerEmail,
        score: metadata.score,
        installs: metadata.installs,
        genre: metadata.genre,
        price: metadata.price,
        is_free: metadata.free,
        updated: new Date(metadata.updated).toISOString(),
        url: metadata.url,
        icon: metadata.icon,
        downloads: validDownloads,
      };

      return {
        provider: PROVIDER_NAME,
        success: true,
        data,
        raw: {
          googlePlay: metadata,
          downloadsCount: downloads.length,
        },
        duration: Date.now() - start,
      };
    } catch (error: any) {
      return {
        provider: PROVIDER_NAME,
        success: false,
        data: {},
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - start,
      };
    }
  },
};

const ALL_PROVIDERS: Provider[] = [apkProvider];

export function lookupApk(
  query: string,
  type?: LookupType,
  originalQuery?: string,
): DualPromiseResult {
  const providers = filterAndSortProviders(ALL_PROVIDERS);
  return executeProvidersBackground(providers, query, type, originalQuery);
}
