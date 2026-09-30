/**
 * Sources that are not tied to one distribution: Flathub, Homebrew, nixpkgs and
 * AppImageHub.
 */

import { config } from '../../config.js';
import type {
  AppData,
  AppEntry,
  LookupType,
  Provider,
  ProviderResult,
} from '../../types/common.js';
import {
  cachedCatalogue,
  failure,
  get,
  getAllowing404,
  matches,
  post,
  result,
  toIso,
} from './shared.js';

/**
 * Flathub search returns no version, so the versions come from a second call per
 * result. Only the entries that can reach the combined list are looked up.
 */
const FLATHUB_VERSION_LOOKUPS = 6;

export const flathubProvider: Provider = {
  name: 'flathub',
  isAvailable: () => true,
  async lookup(query: string, _type?: LookupType): Promise<ProviderResult<AppData>> {
    const start = Date.now();
    try {
      const body = await post<{
        hits?: Array<{
          app_id?: string;
          name?: string;
          summary?: string;
          project_license?: string;
          icon?: string;
          developer_name?: string | null;
          updated_at?: number | string;
        }>;
      }>('https://flathub.org/api/v2/search', { query });

      const hits = body.hits ?? [];
      const versions = new Map<string, string>();
      await Promise.all(
        hits.slice(0, FLATHUB_VERSION_LOOKUPS).map(async (hit) => {
          if (!hit.app_id) return;
          const appstream = await getAllowing404<{ releases?: Array<{ version?: string }> }>(
            `https://flathub.org/api/v2/appstream/${encodeURIComponent(hit.app_id)}`,
          );
          const version = appstream?.releases?.[0]?.version;
          if (version) versions.set(hit.app_id, version);
        }),
      );

      const apps: AppEntry[] = hits.map((hit) => ({
        name: hit.name ?? hit.app_id ?? '',
        source: 'flathub',
        id: hit.app_id ?? null,
        version: hit.app_id ? (versions.get(hit.app_id) ?? null) : null,
        description: hit.summary ?? null,
        url: `https://flathub.org/apps/${hit.app_id ?? ''}`,
        license: hit.project_license ?? null,
        publisher: hit.developer_name ?? null,
        updated: toIso(hit.updated_at),
        icon: hit.icon ?? null,
        platform: 'linux',
        install: hit.app_id ? `flatpak install flathub ${hit.app_id}` : null,
      }));

      return result('flathub', start, query, apps, { hits: hits.length });
    } catch (error) {
      return failure('flathub', start, error);
    }
  },
};

/**
 * Homebrew, as both a formula and a cask.
 *
 * formulae.brew.sh serves one document per package and has no search endpoint;
 * the alternative is its 10 MB full index, which is not worth downloading to
 * answer one query. Matched by exact token, which is what `brew upgrade <name>`
 * uses anyway.
 */
export const homebrewProvider: Provider = {
  name: 'homebrew',
  isAvailable: () => true,
  async lookup(query: string, _type?: LookupType): Promise<ProviderResult<AppData>> {
    const start = Date.now();
    const token = query.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9@._+-]*$/.test(token)) {
      return {
        provider: 'homebrew',
        success: false,
        data: {},
        error: `"${query}" is not a Homebrew token — Homebrew is matched by exact formula or cask name`,
        duration: Date.now() - start,
      };
    }

    try {
      const [formula, cask] = await Promise.all([
        getAllowing404<{
          name?: string;
          desc?: string;
          homepage?: string;
          license?: string | null;
          versions?: { stable?: string };
        }>(`https://formulae.brew.sh/api/formula/${token}.json`),
        getAllowing404<{
          token?: string;
          name?: string[];
          desc?: string;
          homepage?: string;
          version?: string;
        }>(`https://formulae.brew.sh/api/cask/${token}.json`),
      ]);

      const apps: AppEntry[] = [];
      if (formula) {
        apps.push({
          name: formula.name ?? token,
          source: 'homebrew',
          id: formula.name ?? token,
          version: formula.versions?.stable ?? null,
          description: formula.desc ?? null,
          url: `https://formulae.brew.sh/formula/${token}`,
          homepage: formula.homepage ?? null,
          license: formula.license ?? null,
          platform: 'cross-platform',
          install: `brew install ${token}`,
          kind: 'formula',
        });
      }
      if (cask) {
        apps.push({
          name: cask.name?.[0] ?? cask.token ?? token,
          source: 'homebrew',
          id: cask.token ?? token,
          version: cask.version ?? null,
          description: cask.desc ?? null,
          url: `https://formulae.brew.sh/cask/${token}`,
          homepage: cask.homepage ?? null,
          platform: 'macos',
          install: `brew install --cask ${token}`,
          kind: 'cask',
        });
      }

      return result('homebrew', start, query, apps);
    } catch (error) {
      return failure('homebrew', start, error);
    }
  },
};

/**
 * nixpkgs, through the Elasticsearch index behind search.nixos.org.
 *
 * NixOS publishes no open package search API: search.nixos.org talks to an
 * Elasticsearch cluster using a read-only account whose credentials are baked
 * into its frontend. Reusing someone else's embedded credentials is not this
 * service's call to make, so the endpoint and account are configuration. With
 * none set the provider reports itself unconfigured instead of failing, which is
 * how the probe tells the two apart.
 */
export const nixpkgsProvider: Provider = {
  name: 'nixpkgs',
  isAvailable: () =>
    config.nixpkgsSearchUrl !== '' &&
    config.nixpkgsSearchUser !== '' &&
    config.nixpkgsSearchPassword !== '',
  async lookup(query: string, _type?: LookupType): Promise<ProviderResult<AppData>> {
    const start = Date.now();
    try {
      const body = await post<{
        hits?: {
          hits?: Array<{
            _source?: {
              package_attr_name?: string;
              package_pname?: string;
              package_pversion?: string;
              package_description?: string;
              package_homepage?: string[];
              package_license_set?: string[];
            };
          }>;
        };
      }>(
        config.nixpkgsSearchUrl,
        {
          size: 20,
          query: {
            bool: {
              must: [
                { term: { type: 'package' } },
                { multi_match: { query, fields: ['package_attr_name^3', 'package_description'] } },
              ],
            },
          },
        },
        {
          auth: { username: config.nixpkgsSearchUser, password: config.nixpkgsSearchPassword },
        },
      );

      const apps: AppEntry[] = (body.hits?.hits ?? []).map((hit) => {
        const src = hit._source ?? {};
        const attr = src.package_attr_name ?? '';
        return {
          name: src.package_pname ?? attr,
          source: 'nixpkgs',
          id: attr || null,
          version: src.package_pversion ?? null,
          description: src.package_description ?? null,
          url: `https://search.nixos.org/packages?query=${encodeURIComponent(attr)}`,
          homepage: src.package_homepage?.[0] ?? null,
          license: src.package_license_set?.join(', ') ?? null,
          platform: 'linux',
          install: attr ? `nix profile install nixpkgs#${attr}` : null,
        };
      });

      return result('nixpkgs', start, query, apps, { hits: body.hits?.hits?.length ?? 0 });
    } catch (error) {
      return failure('nixpkgs', start, error);
    }
  },
};

interface AppImageItem {
  name?: string;
  description?: string;
  license?: string | null;
  categories?: string[];
  authors?: Array<{ name?: string; url?: string }>;
  links?: Array<{ type?: string; url?: string }>;
  icons?: string[];
}

/** The AppImageHub catalogue, fetched whole and reused for an hour. */
export const appImageCatalogue = cachedCatalogue(60 * 60 * 1000, () =>
  get<{ items?: AppImageItem[] }>('https://appimage.github.io/feed.json'),
);

/**
 * AppImageHub, from its published catalogue.
 *
 * The catalogue is the only interface — there is no search endpoint and no
 * per-app document — so it is downloaded once and searched in memory. It records
 * no versions: an AppImage's version lives in whatever release the author
 * publishes, which is what the `url` here points at.
 */
export const appimagehubProvider: Provider = {
  name: 'appimagehub',
  isAvailable: () => true,
  async lookup(query: string, _type?: LookupType): Promise<ProviderResult<AppData>> {
    const start = Date.now();
    try {
      const feed = await appImageCatalogue();
      const items = feed.items ?? [];
      if (items.length === 0) throw new Error('AppImageHub catalogue was empty');

      const apps: AppEntry[] = items
        .filter((item) => matches(query, item.name, item.description))
        .map((item) => {
          const download = item.links?.find((l) => l.type === 'Download')?.url;
          const repo = item.links?.find((l) => l.type === 'GitHub')?.url;
          return {
            name: item.name ?? '',
            source: 'appimagehub',
            id: item.name ?? null,
            // The catalogue carries no version; saying so beats inventing one.
            version: null,
            description: item.description ?? null,
            url: `https://appimage.github.io/${encodeURIComponent(item.name ?? '')}/`,
            homepage: download ?? (repo ? `https://github.com/${repo}` : null),
            license: item.license ?? null,
            publisher: item.authors?.[0]?.name ?? null,
            platform: 'linux',
          };
        });

      return result('appimagehub', start, query, apps, { catalogue: items.length });
    } catch (error) {
      return failure('appimagehub', start, error);
    }
  },
};
