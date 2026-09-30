/**
 * Windows software sources: winget, Chocolatey and Scoop.
 */

import * as cheerio from 'cheerio';
import type { AppEntry, LookupType, Provider, ProviderResult } from '../../types/common.js';
import type { AppData } from '../../types/common.js';
import { failure, get, getAllowing404, post, result, toIso } from './shared.js';

/**
 * winget, through the same endpoint the winget client itself queries.
 *
 * Preferred over reading manifests out of the microsoft/winget-pkgs repository:
 * that would mean either a GitHub code search (rate limited to a handful of
 * unauthenticated requests a minute) or cloning a repository of ~10k manifests.
 * This is the official REST source behind `winget search`, needs no key, and
 * returns the version the client would install.
 */
export const wingetProvider: Provider = {
  name: 'winget',
  isAvailable: () => true,
  async lookup(query: string, _type?: LookupType): Promise<ProviderResult<AppData>> {
    const start = Date.now();
    try {
      const body = await post<{
        Data?: Array<{
          PackageIdentifier?: string;
          PackageName?: string;
          Publisher?: string;
          Versions?: Array<{ PackageVersion?: string }>;
        }>;
      }>('https://storeedgefd.dsx.mp.microsoft.com/v9.0/manifestSearch', {
        Query: { KeyWord: query, MatchType: 'Substring' },
        MaximumResults: 20,
      });

      const apps: AppEntry[] = (body.Data ?? []).map((entry) => {
        const id = entry.PackageIdentifier ?? '';
        // The source reports "Unknown" for Microsoft Store entries, which carry
        // no winget version of their own. That is an absent version, not a
        // version literally called Unknown.
        const version = entry.Versions?.[0]?.PackageVersion;
        return {
          name: entry.PackageName || id,
          source: 'winget',
          id,
          version: version && version !== 'Unknown' ? version : null,
          publisher: entry.Publisher ?? null,
          platform: 'windows',
          url: `https://winget.run/pkg/${id.split('.').join('/')}`,
          install: id ? `winget install --id ${id}` : null,
        };
      });

      return result('winget', start, query, apps, body);
    } catch (error) {
      return failure('winget', start, error);
    }
  },
};

/**
 * The Chocolatey community repository, over its NuGet OData feed.
 *
 * The feed answers Atom XML only — there is no JSON representation — so this is
 * the one source parsed as XML rather than JSON. `IsLatestVersion` is not used
 * as a filter because combining it with `searchTerm` is rejected as a syntax
 * error; the feed already returns latest-first.
 */
export const chocolateyProvider: Provider = {
  name: 'chocolatey',
  isAvailable: () => true,
  async lookup(query: string, _type?: LookupType): Promise<ProviderResult<AppData>> {
    const start = Date.now();
    const url =
      'https://community.chocolatey.org/api/v2/Search()' +
      `?searchTerm='${encodeURIComponent(query)}'&targetFramework=''&includePrerelease=false&$top=20`;
    try {
      // The feed answers 406 to axios's default `Accept: application/json, …`.
      // It serves Atom and nothing else, and says so by refusing.
      const xml = await get<string>(url, {
        responseType: 'text',
        headers: { Accept: 'application/atom+xml' },
      });
      const $ = cheerio.load(xml, { xmlMode: true });
      const apps: AppEntry[] = [];

      $('entry').each((_, el) => {
        const entry = $(el);
        const prop = (name: string) => entry.find(`m\\:properties > d\\:${name}`).text().trim();
        // The package id lives only in the entry's own OData URL —
        // Packages(Id='Firefox',Version='141.0.0') — not in the property bag.
        const id = /Id='([^']+)'/.exec(entry.find('id').first().text())?.[1] ?? '';
        const name = prop('Title') || entry.find('title').first().text().trim() || id;
        if (!id && !name) return;
        apps.push({
          name,
          source: 'chocolatey',
          id: id || null,
          version: prop('Version') || null,
          description: entry.find('summary').first().text().trim() || prop('Description') || null,
          url: id ? `https://community.chocolatey.org/packages/${id}` : null,
          homepage: prop('ProjectUrl') || null,
          license: prop('LicenseUrl') || null,
          publisher: entry.find('author > name').first().text().trim() || null,
          updated: toIso(prop('Published')),
          icon: prop('IconUrl') || null,
          platform: 'windows',
          install: id ? `choco install ${id}` : null,
          downloads: Number(prop('DownloadCount')) || null,
        });
      });

      return result('chocolatey', start, query, apps, { url, entries: apps.length });
    } catch (error) {
      return failure('chocolatey', start, error);
    }
  },
};

/**
 * The Scoop buckets that ship with, or are officially known to, Scoop.
 *
 * Scoop's own search runs on an Azure Cognitive Search index whose key is
 * embedded in the scoop.sh page. Rather than borrow someone else's key, this
 * reads the bucket manifests straight from GitHub, which is where Scoop itself
 * gets them. The cost is that it matches a manifest name exactly — which is what
 * the "is there an update for <package>" case needs, and is honest about missing
 * a fuzzy search.
 */
const SCOOP_BUCKETS = ['Main', 'Extras', 'Versions', 'Java', 'Nonportable', 'PHP'];

interface ScoopManifest {
  version?: string;
  description?: string;
  homepage?: string;
  license?: string | { identifier?: string };
}

export const scoopProvider: Provider = {
  name: 'scoop',
  isAvailable: () => true,
  async lookup(query: string, _type?: LookupType): Promise<ProviderResult<AppData>> {
    const start = Date.now();
    const manifest = query.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9._+-]*$/.test(manifest)) {
      return {
        provider: 'scoop',
        success: false,
        data: {},
        error: `"${query}" is not a Scoop manifest name — Scoop is matched by exact app name`,
        duration: Date.now() - start,
      };
    }

    const attempts = SCOOP_BUCKETS.map(async (bucket) => {
      const url = `https://raw.githubusercontent.com/ScoopInstaller/${bucket}/master/bucket/${manifest}.json`;
      const body = await getAllowing404<ScoopManifest>(url);
      return body === null ? null : { bucket, body };
    });

    const settled = await Promise.allSettled(attempts);
    // Every bucket failing for a reason other than "not here" is the endpoint
    // being down, and has to be reported as such rather than as an empty answer.
    const reasons = settled.filter((s) => s.status === 'rejected');
    if (reasons.length === settled.length) {
      return failure('scoop', start, (reasons[0] as PromiseRejectedResult).reason);
    }

    const apps: AppEntry[] = [];
    for (const outcome of settled) {
      if (outcome.status !== 'fulfilled' || outcome.value === null) continue;
      const { bucket, body } = outcome.value;
      const license = typeof body.license === 'string' ? body.license : body.license?.identifier;
      apps.push({
        name: manifest,
        source: 'scoop',
        id: `${bucket.toLowerCase()}/${manifest}`,
        version: body.version ?? null,
        description: body.description ?? null,
        url: `https://scoop.sh/#/apps?q=${encodeURIComponent(manifest)}`,
        homepage: body.homepage ?? null,
        license: license ?? null,
        platform: 'windows',
        install: `scoop install ${bucket.toLowerCase()}/${manifest}`,
        bucket,
      });
    }

    return result('scoop', start, query, apps, { buckets: SCOOP_BUCKETS });
  },
};
