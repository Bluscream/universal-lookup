/**
 * Distribution package sources: Arch (official and AUR), Debian, Ubuntu, Fedora
 * and Alpine.
 *
 * Which of these can search and which can only answer about an exact name is a
 * property of the distribution, not a shortcut taken here: Fedora's mdapi and
 * Alpine's index are keyed by package name, so those providers say so in their
 * error rather than pretending the package does not exist.
 */

import * as cheerio from 'cheerio';
import type {
  AppData,
  AppEntry,
  LookupType,
  Provider,
  ProviderResult,
} from '../../types/common.js';
import { failure, get, getAllowing404, result, toIso } from './shared.js';

export const aurProvider: Provider = {
  name: 'aur',
  isAvailable: () => true,
  async lookup(query: string, _type?: LookupType): Promise<ProviderResult<AppData>> {
    const start = Date.now();
    try {
      const body = await get<{
        type?: string;
        error?: string;
        results?: Array<{
          Name?: string;
          Version?: string;
          Description?: string;
          URL?: string;
          License?: string[];
          Maintainer?: string | null;
          LastModified?: number;
          NumVotes?: number;
        }>;
      }>(`https://aur.archlinux.org/rpc/v5/search/${encodeURIComponent(query)}?by=name-desc`);

      if (body.type === 'error') throw new Error(`AUR reported: ${body.error ?? 'unknown error'}`);

      const apps: AppEntry[] = (body.results ?? [])
        // The RPC returns every match unsorted; votes are the only popularity
        // signal it gives, and an unsorted slice of 10 from 400 is noise.
        .sort((a, b) => (b.NumVotes ?? 0) - (a.NumVotes ?? 0))
        .map((pkg) => ({
          name: pkg.Name ?? '',
          source: 'aur',
          id: pkg.Name ?? null,
          version: pkg.Version ?? null,
          description: pkg.Description ?? null,
          url: `https://aur.archlinux.org/packages/${pkg.Name ?? ''}`,
          homepage: pkg.URL ?? null,
          license: pkg.License?.join(', ') ?? null,
          publisher: pkg.Maintainer ?? null,
          updated: toIso(pkg.LastModified),
          platform: 'linux',
          install: pkg.Name ? `paru -S ${pkg.Name}` : null,
          votes: pkg.NumVotes ?? null,
        }));

      return result('aur', start, query, apps, { count: body.results?.length ?? 0 });
    } catch (error) {
      return failure('aur', start, error);
    }
  },
};

export const archlinuxProvider: Provider = {
  name: 'archlinux',
  isAvailable: () => true,
  async lookup(query: string, _type?: LookupType): Promise<ProviderResult<AppData>> {
    const start = Date.now();
    try {
      const body = await get<{
        results?: Array<{
          pkgname?: string;
          pkgver?: string;
          pkgrel?: string;
          pkgdesc?: string;
          url?: string;
          licenses?: string[];
          packager?: string;
          repo?: string;
          arch?: string;
          last_update?: string;
        }>;
      }>(`https://archlinux.org/packages/search/json/?q=${encodeURIComponent(query)}`);

      const apps: AppEntry[] = (body.results ?? []).map((pkg) => ({
        name: pkg.pkgname ?? '',
        source: 'archlinux',
        id: pkg.pkgname ?? null,
        version: pkg.pkgver ? `${pkg.pkgver}-${pkg.pkgrel ?? ''}`.replace(/-$/, '') : null,
        description: pkg.pkgdesc ?? null,
        url: `https://archlinux.org/packages/${pkg.repo}/${pkg.arch}/${pkg.pkgname}/`,
        homepage: pkg.url ?? null,
        license: pkg.licenses?.join(', ') ?? null,
        publisher: pkg.packager ?? null,
        updated: toIso(pkg.last_update),
        platform: 'linux',
        install: pkg.pkgname ? `pacman -S ${pkg.pkgname}` : null,
        repository: pkg.repo ?? null,
      }));

      return result('archlinux', start, query, apps, { count: body.results?.length ?? 0 });
    } catch (error) {
      return failure('archlinux', start, error);
    }
  },
};

/**
 * Debian, through ftp-master's madison API.
 *
 * The obvious endpoint is sources.debian.org's `/api/search/`, which does
 * substring matching — but it answers non-browser clients with a proof-of-work
 * challenge page at status 200, so every field reads as empty and the provider
 * reports a block as "no results". madison is a plain JSON API with no such
 * gate; the cost is that it matches a source package name exactly, which is what
 * checking a known package for updates needs anyway.
 *
 * Shape: `[{ "<package>": { "<suite>": { "<version>": {…} } } }]`.
 */
type MadisonResponse = Array<
  Record<string, Record<string, Record<string, { component?: string }>>>
>;

export const debianProvider: Provider = {
  name: 'debian',
  isAvailable: () => true,
  async lookup(query: string, _type?: LookupType): Promise<ProviderResult<AppData>> {
    const start = Date.now();
    const name = query.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9.+-]*$/.test(name)) {
      return {
        provider: 'debian',
        success: false,
        data: {},
        error: `"${query}" is not a Debian package name — madison matches names exactly`,
        duration: Date.now() - start,
      };
    }

    try {
      const body = await get<MadisonResponse>(
        `https://api.ftp-master.debian.org/madison?package=${encodeURIComponent(name)}&f=json`,
      );

      const apps: AppEntry[] = [];
      for (const entry of body) {
        for (const [pkg, suites] of Object.entries(entry)) {
          for (const [suite, versions] of Object.entries(suites)) {
            // The -debug suites carry the same versions as their parent and only
            // ever hold debug symbols; listing them doubles every row.
            if (suite.endsWith('-debug')) continue;
            const newest = Object.keys(versions).sort().pop();
            if (!newest) continue;
            apps.push({
              name: pkg,
              source: 'debian',
              id: pkg,
              version: newest,
              url: `https://packages.debian.org/${suite}/${pkg}`,
              platform: 'linux',
              install: `apt install ${pkg}`,
              suite,
              component: versions[newest]?.component ?? null,
            });
          }
        }
      }

      return result('debian', start, query, apps, body);
    } catch (error) {
      return failure('debian', start, error);
    }
  },
};

export const ubuntuProvider: Provider = {
  name: 'ubuntu',
  isAvailable: () => true,
  async lookup(query: string, _type?: LookupType): Promise<ProviderResult<AppData>> {
    const start = Date.now();
    const url =
      'https://api.launchpad.net/devel/ubuntu/+archive/primary' +
      `?ws.op=getPublishedSources&source_name=${encodeURIComponent(query)}&status=Published`;
    try {
      const body = await get<{
        entries?: Array<{
          source_package_name?: string;
          source_package_version?: string;
          distro_series_link?: string;
          date_published?: string;
          component_name?: string;
        }>;
      }>(url);

      // Launchpad publishes one row per series per version, so a popular package
      // comes back dozens of times. One row per package name, newest first, is
      // the answer a client asked for.
      const seen = new Set<string>();
      const apps: AppEntry[] = [];
      for (const entry of body.entries ?? []) {
        const name = entry.source_package_name ?? '';
        if (!name || seen.has(name)) continue;
        seen.add(name);
        apps.push({
          name,
          source: 'ubuntu',
          id: name,
          version: entry.source_package_version ?? null,
          url: `https://packages.ubuntu.com/${name}`,
          updated: toIso(entry.date_published),
          platform: 'linux',
          install: `apt install ${name}`,
          series: entry.distro_series_link?.split('/').pop() ?? null,
          component: entry.component_name ?? null,
        });
      }

      return result('ubuntu', start, query, apps, { entries: body.entries?.length ?? 0 });
    } catch (error) {
      return failure('ubuntu', start, error);
    }
  },
};

/**
 * Fedora, through mdapi.
 *
 * mdapi is keyed by exact package name — it has no search — so a query that is
 * not a package name gets a "no such package", which is the truth.
 */
export const fedoraProvider: Provider = {
  name: 'fedora',
  isAvailable: () => true,
  async lookup(query: string, _type?: LookupType): Promise<ProviderResult<AppData>> {
    const start = Date.now();
    const name = query.trim().toLowerCase();
    try {
      const body = await getAllowing404<{
        basename?: string;
        version?: string;
        release?: string;
        epoch?: string;
        summary?: string;
        description?: string;
        url?: string;
        license?: string;
        repo?: string;
      }>(`https://mdapi.fedoraproject.org/rawhide/pkg/${encodeURIComponent(name)}`);

      if (!body) {
        return {
          provider: 'fedora',
          success: false,
          data: {},
          error: `No Fedora package named "${query}" — mdapi matches package names exactly`,
          duration: Date.now() - start,
        };
      }

      const app: AppEntry = {
        name: body.basename ?? name,
        source: 'fedora',
        id: body.basename ?? name,
        version: body.version ? `${body.version}-${body.release ?? ''}`.replace(/-$/, '') : null,
        description: body.summary ?? body.description ?? null,
        url: `https://packages.fedoraproject.org/pkgs/${body.basename ?? name}/`,
        homepage: body.url ?? null,
        license: body.license ?? null,
        platform: 'linux',
        install: `dnf install ${body.basename ?? name}`,
        repository: body.repo ?? null,
      };

      return result('fedora', start, query, [app], body);
    } catch (error) {
      return failure('fedora', start, error);
    }
  },
};

/**
 * Alpine, scraped from pkgs.alpinelinux.org.
 *
 * Alpine publishes no JSON API; the package browser is the index. The table is
 * stable and column-classed (`td.package`, `td.version`, …), so this reads those
 * classes rather than column positions.
 */
export const alpineProvider: Provider = {
  name: 'alpine',
  isAvailable: () => true,
  async lookup(query: string, _type?: LookupType): Promise<ProviderResult<AppData>> {
    const start = Date.now();
    const url = `https://pkgs.alpinelinux.org/packages?name=${encodeURIComponent(`${query.trim()}*`)}&branch=edge&arch=x86_64`;
    try {
      const html = await get<string>(url, { responseType: 'text' });
      const $ = cheerio.load(html);
      const rows = $('table tbody tr');
      if (rows.length === 0 && $('table').length === 0) {
        throw new Error('Alpine package browser returned no table — layout changed?');
      }

      const apps: AppEntry[] = [];
      rows.each((_, el) => {
        const row = $(el);
        const name = row.find('td.package a').text().trim();
        if (!name) return;
        const repo = row.find('td.repo').text().trim();
        apps.push({
          name,
          source: 'alpine',
          id: name,
          version: row.find('td.version').text().trim() || null,
          description: row.find('td.package a').attr('aria-label') ?? null,
          url: `https://pkgs.alpinelinux.org${row.find('td.package a').attr('href') ?? ''}`,
          homepage: row.find('td.url a').attr('href') ?? null,
          license: row.find('td.license').text().trim() || null,
          publisher: row.find('td.maintainer').text().trim() || null,
          updated: toIso(row.find('td.bdate').text().trim()),
          platform: 'linux',
          install: `apk add ${name}`,
          repository: repo || null,
        });
      });

      return result('alpine', start, query, apps, { url, rows: rows.length });
    } catch (error) {
      return failure('alpine', start, error);
    }
  },
};
