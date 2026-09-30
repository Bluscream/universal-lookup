import axios from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  alpineProvider,
  archlinuxProvider,
  aurProvider,
  debianProvider,
  fedoraProvider,
  ubuntuProvider,
} from '../backend/src/providers/app/linux-distro.js';
import { mergeResponses } from '../backend/src/lib/merger.js';
import { PROVIDER_NAMES, PROVIDERS } from '../backend/src/providers/app/index.js';
import {
  chocolateyProvider,
  scoopProvider,
  wingetProvider,
} from '../backend/src/providers/app/windows.js';
import {
  appImageCatalogue,
  appimagehubProvider,
  flathubProvider,
  homebrewProvider,
  nixpkgsProvider,
} from '../backend/src/providers/app/crossplatform.js';
import { githubProvider } from '../backend/src/providers/app/github.js';
import { fdroidProvider, izzyondroidProvider } from '../backend/src/providers/app/android.js';
import type { AppEntry, ProviderResult } from '../backend/src/types/common.js';

/**
 * The `app` lookup, offline.
 *
 * Two things have to hold and neither is obvious from reading one provider:
 * every source must emit the same canonical keys, so the combined list is usable
 * without knowing who answered; and a source that breaks must say so, because
 * the failure this codebase keeps rediscovering is a provider returning an empty
 * list when the real cause was a 403.
 */
vi.mock('axios');
const mockedAxios = vi.mocked(axios, true);

function routeGet(handlers: Record<string, unknown>) {
  mockedAxios.get.mockImplementation(async (url: string) => {
    for (const [fragment, data] of Object.entries(handlers)) {
      if (url.includes(fragment)) {
        if (data instanceof Error) throw data;
        return { data, status: 200 } as never;
      }
    }
    throw new Error(`unexpected GET ${url}`);
  });
}

function routePost(handlers: Record<string, unknown>) {
  mockedAxios.post.mockImplementation(async (url: string) => {
    for (const [fragment, data] of Object.entries(handlers)) {
      if (url.includes(fragment)) {
        if (data instanceof Error) throw data;
        return { data, status: 200 } as never;
      }
    }
    throw new Error(`unexpected POST ${url}`);
  });
}

/** An axios 4xx/5xx, as axios itself reports it. */
function httpError(status: number, url: string): Error {
  const error = Object.assign(new Error(`Request failed with status code ${status}`), {
    isAxiosError: true,
    config: { url },
    response: { status, data: '' },
  });
  mockedAxios.isAxiosError.mockImplementation(
    (e: unknown) => (e as { isAxiosError?: boolean })?.isAxiosError === true,
  );
  return error;
}

function apps(result: ProviderResult<{ apps?: AppEntry[] | null }>): AppEntry[] {
  return result.data.apps ?? [];
}

beforeEach(() => {
  vi.clearAllMocks();
  // The catalogue is cached across calls on purpose; without this, a test that
  // fetched it successfully would hide the next test's failing fetch.
  appImageCatalogue.clear();
  mockedAxios.isAxiosError.mockImplementation(
    (e: unknown) => (e as { isAxiosError?: boolean })?.isAxiosError === true,
  );
});

describe('each source parses its own shape into the shared keys', () => {
  it('winget reads the manifestSearch response', async () => {
    routePost({
      manifestSearch: {
        Data: [
          {
            PackageIdentifier: 'Mozilla.Firefox',
            PackageName: 'Mozilla Firefox',
            Publisher: 'Mozilla',
            Versions: [{ PackageVersion: '157.0' }],
          },
          // A Microsoft Store entry, which carries no winget version of its own.
          {
            PackageIdentifier: '9NZVDKPMR9RD',
            PackageName: 'Mozilla Firefox',
            Publisher: 'Mozilla',
            Versions: [{ PackageVersion: 'Unknown' }],
          },
        ],
      },
    });

    const [pkg, store] = apps(await wingetProvider.lookup('firefox', 'app'));
    expect(pkg).toMatchObject({
      name: 'Mozilla Firefox',
      source: 'winget',
      id: 'Mozilla.Firefox',
      version: '157.0',
      platform: 'windows',
      install: 'winget install --id Mozilla.Firefox',
    });
    // "Unknown" is an absent version, not a version called Unknown.
    expect(store.version).toBeNull();
  });

  it('chocolatey reads the OData Atom feed, including the id in the entry URL', async () => {
    routeGet({
      'chocolatey.org': `<?xml version="1.0" encoding="utf-8"?>
        <feed xmlns="http://www.w3.org/2005/Atom"
              xmlns:d="http://schemas.microsoft.com/ado/2007/08/dataservices"
              xmlns:m="http://schemas.microsoft.com/ado/2007/08/dataservices/metadata">
          <entry>
            <id>https://community.chocolatey.org/api/v2/Packages(Id='Firefox',Version='141.0.0')</id>
            <title type="text">Firefox</title>
            <summary type="text">Bringing together all kinds of awesomeness</summary>
            <author><name>Mozilla</name></author>
            <m:properties>
              <d:Version>141.0.0</d:Version>
              <d:Title>Mozilla Firefox</d:Title>
              <d:ProjectUrl>https://www.mozilla.org/firefox/</d:ProjectUrl>
              <d:LicenseUrl>https://www.mozilla.org/MPL/2.0/</d:LicenseUrl>
              <d:Published>2025-07-22T18:14:50.293</d:Published>
              <d:DownloadCount>91925925</d:DownloadCount>
            </m:properties>
          </entry>
        </feed>`,
    });

    const [entry] = apps(await chocolateyProvider.lookup('firefox', 'app'));
    expect(entry).toMatchObject({
      name: 'Mozilla Firefox',
      source: 'chocolatey',
      id: 'Firefox',
      version: '141.0.0',
      publisher: 'Mozilla',
      install: 'choco install Firefox',
    });
    expect(entry.updated).toBe('2025-07-22T18:14:50.293Z');
  });

  it('scoop reports the buckets that carry the manifest, and ignores the ones that do not', async () => {
    routeGet({
      '/Extras/master/bucket/firefox.json': {
        version: '157.0',
        description: 'Popular open source web browser.',
        homepage: 'https://www.firefox.com/',
        license: 'MPL-2.0',
      },
      '/master/bucket/firefox.json': httpError(404, 'raw.githubusercontent.com'),
    });

    const result = await scoopProvider.lookup('firefox', 'app');
    expect(result.success).toBe(true);
    expect(apps(result)).toHaveLength(1);
    expect(apps(result)[0]).toMatchObject({
      source: 'scoop',
      id: 'extras/firefox',
      version: '157.0',
      license: 'MPL-2.0',
      install: 'scoop install extras/firefox',
    });
  });

  it('flathub fills each hit version in from the appstream document', async () => {
    routePost({
      '/api/v2/search': {
        hits: [
          {
            app_id: 'org.mozilla.firefox',
            name: 'Firefox',
            summary: 'Fast, Private & Safe Web Browser',
            project_license: 'MPL-2.0',
            developer_name: 'Mozilla',
            updated_at: 1790685530,
          },
        ],
      },
    });
    routeGet({ '/api/v2/appstream/': { releases: [{ version: '157.0' }] } });

    const [entry] = apps(await flathubProvider.lookup('firefox', 'app'));
    expect(entry).toMatchObject({
      name: 'Firefox',
      source: 'flathub',
      id: 'org.mozilla.firefox',
      version: '157.0',
      license: 'MPL-2.0',
      install: 'flatpak install flathub org.mozilla.firefox',
    });
  });

  it('homebrew returns the formula and the cask as separate rows', async () => {
    routeGet({
      '/api/formula/': {
        name: 'wget',
        desc: 'Internet file retriever',
        versions: { stable: '1.25.0' },
      },
      '/api/cask/': { token: 'wget', name: ['Wget'], version: '1.0' },
    });

    const rows = apps(await homebrewProvider.lookup('wget', 'app'));
    expect(rows.map((r) => r.install)).toEqual(['brew install wget', 'brew install --cask wget']);
    expect(rows[0].version).toBe('1.25.0');
  });

  it('aur sorts by votes and keeps the canonical keys', async () => {
    routeGet({
      'aur.archlinux.org': {
        results: [
          { Name: 'firefox-nightly', Version: '1', NumVotes: 2, License: ['MPL2'] },
          {
            Name: 'firefox-developer-edition',
            Version: '157.0b1',
            NumVotes: 300,
            License: ['MPL2'],
          },
        ],
      },
    });

    const rows = apps(await aurProvider.lookup('firefox', 'app'));
    expect(rows[0]).toMatchObject({
      name: 'firefox-developer-edition',
      source: 'aur',
      version: '157.0b1',
      license: 'MPL2',
      install: 'paru -S firefox-developer-edition',
    });
  });

  it('archlinux joins pkgver and pkgrel into one version', async () => {
    routeGet({
      'archlinux.org/packages/search': {
        results: [
          {
            pkgname: 'firefox',
            pkgver: '157.0',
            pkgrel: '1',
            repo: 'extra',
            arch: 'x86_64',
            licenses: ['MPL-2.0'],
            last_update: '2026-09-01T00:00:00Z',
          },
        ],
      },
    });

    expect(apps(await archlinuxProvider.lookup('firefox', 'app'))[0]).toMatchObject({
      source: 'archlinux',
      version: '157.0-1',
      url: 'https://archlinux.org/packages/extra/x86_64/firefox/',
    });
  });

  it('debian reads madison, skipping the -debug suites', async () => {
    routeGet({
      'api.ftp-master.debian.org': [
        {
          firefox: {
            unstable: { '153.0.3-1': { component: 'main' }, '157.0-1': { component: 'main' } },
            'unstable-debug': { '157.0-1': { component: 'main' } },
          },
        },
      ],
    });

    const rows = apps(await debianProvider.lookup('firefox', 'app'));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      source: 'debian',
      name: 'firefox',
      version: '157.0-1',
      suite: 'unstable',
      install: 'apt install firefox',
    });
  });

  it('debian calls an HTML challenge page a failure, not an empty answer', async () => {
    // sources.debian.org used to be the source here and answered 200 with a
    // proof-of-work page; every field read as undefined and the provider said
    // "no packages". A wrong content type is a block, and has to read as one.
    routeGet({ 'api.ftp-master.debian.org': '<!DOCTYPE html><title>I Challenge Thee</title>' });

    const result = await debianProvider.lookup('firefox', 'app');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/HTML page instead of JSON/);
  });

  it('ubuntu collapses launchpad’s per-series rows to one per package', async () => {
    routeGet({
      'api.launchpad.net': {
        entries: [
          { source_package_name: 'firefox', source_package_version: '1:1snap1-0ubuntu11' },
          { source_package_name: 'firefox', source_package_version: '1:1snap1-0ubuntu10' },
          { source_package_name: 'firefox-locale-de', source_package_version: '1:1' },
        ],
      },
    });

    const rows = apps(await ubuntuProvider.lookup('firefox', 'app'));
    expect(rows.map((r) => r.name)).toEqual(['firefox', 'firefox-locale-de']);
    expect(rows[0].version).toBe('1:1snap1-0ubuntu11');
  });

  it('fedora joins version and release', async () => {
    routeGet({
      'mdapi.fedoraproject.org': {
        basename: 'firefox',
        version: '156.0.1',
        release: '1.fc46',
        summary: 'Mozilla Firefox Web browser',
        license: 'MPL-2.0',
      },
    });

    expect(apps(await fedoraProvider.lookup('firefox', 'app'))[0]).toMatchObject({
      source: 'fedora',
      version: '156.0.1-1.fc46',
      install: 'dnf install firefox',
    });
  });

  it('alpine reads the package browser table by column class', async () => {
    routeGet({
      'pkgs.alpinelinux.org': `<table><thead><tr><th>Package</th></tr></thead><tbody><tr>
        <td class="package"><a aria-label="Firefox web browser" href="/package/edge/community/x86_64/firefox">firefox</a></td>
        <td class="version"><strong>154.0-r0</strong></td>
        <td class="url"><a href="https://www.firefox.com/">URL</a></td>
        <td class="license"><span>MPL-2.0</span></td>
        <td class="repo">community</td>
        <td class="maintainer">Someone</td>
        <td class="bdate">2026-01-02</td>
      </tr></tbody></table>`,
    });

    expect(apps(await alpineProvider.lookup('firefox', 'app'))[0]).toMatchObject({
      source: 'alpine',
      name: 'firefox',
      version: '154.0-r0',
      license: 'MPL-2.0',
      repository: 'community',
      install: 'apk add firefox',
    });
  });

  it('appimagehub searches the catalogue it downloaded', async () => {
    routeGet({
      'appimage.github.io': {
        items: [
          {
            name: 'Firefox',
            description: 'Web browser',
            links: [{ type: 'GitHub', url: 'srevinsaju/firefox-appimage' }],
          },
          { name: 'Krita', description: 'Painting' },
        ],
      },
    });

    const rows = apps(await appimagehubProvider.lookup('firefox', 'app'));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: 'appimagehub', name: 'Firefox', version: null });
  });

  it('fdroid pairs the search page with the repository version API', async () => {
    routeGet({
      'search.f-droid.org': `<a class="package-header" href="https://f-droid.org/en/packages/org.mozilla.fennec_fdroid">
          <img class="package-icon" src="https://example.invalid/icon.png" />
          <h4 class="package-name">Fennec F-Droid</h4>
          <span class="package-summary">Browse the web</span><span class="package-license">MPL-2.0</span>
        </a>`,
      '/api/v1/packages/': {
        packageName: 'org.mozilla.fennec_fdroid',
        packages: [{ versionName: '156.0.0' }],
      },
    });

    expect(apps(await fdroidProvider.lookup('firefox', 'app'))[0]).toMatchObject({
      source: 'fdroid',
      id: 'org.mozilla.fennec_fdroid',
      name: 'Fennec F-Droid',
      version: '156.0.0',
      license: 'MPL-2.0',
      platform: 'android',
    });
  });

  it('izzyondroid answers for an application id', async () => {
    routeGet({
      'apt.izzysoft.de': {
        packageName: 'dev.imranr.obtainium',
        packages: [{ versionName: '1.6.17' }],
      },
    });

    expect(apps(await izzyondroidProvider.lookup('dev.imranr.obtainium', 'app'))[0]).toMatchObject({
      source: 'izzyondroid',
      version: '1.6.17',
    });
  });

  it('github carries the latest release tag as the version', async () => {
    routeGet({
      '/search/repositories': {
        items: [
          {
            full_name: 'mozilla-firefox/firefox',
            name: 'firefox',
            html_url: 'https://github.com/mozilla-firefox/firefox',
            license: { spdx_id: 'MPL-2.0' },
            owner: { login: 'mozilla-firefox' },
            stargazers_count: 1000,
          },
        ],
      },
      '/releases/latest': { tag_name: 'v157.0', published_at: '2026-09-01T00:00:00Z' },
    });

    expect(apps(await githubProvider.lookup('firefox', 'app'))[0]).toMatchObject({
      source: 'github',
      id: 'mozilla-firefox/firefox',
      version: '157.0',
      updated: '2026-09-01T00:00:00.000Z',
    });
  });
});

describe('the sources merge into one list', () => {
  it('concatenates every source’s apps under the one canonical key', async () => {
    routePost({
      manifestSearch: {
        Data: [
          {
            PackageIdentifier: 'Mozilla.Firefox',
            PackageName: 'Firefox',
            Versions: [{ PackageVersion: '157.0' }],
          },
        ],
      },
    });
    routeGet({
      'archlinux.org/packages/search': {
        results: [
          { pkgname: 'firefox', pkgver: '157.0', pkgrel: '1', repo: 'extra', arch: 'x86_64' },
        ],
      },
      'mdapi.fedoraproject.org': { basename: 'firefox', version: '156.0.1', release: '1.fc46' },
    });

    const results = await Promise.all(
      [wingetProvider, archlinuxProvider, fedoraProvider].map((p) => p.lookup('firefox', 'app')),
    );
    const merged = mergeResponses(results) as { apps: AppEntry[] };

    expect(merged.apps).toHaveLength(3);
    expect(merged.apps.map((a) => a.source)).toEqual(['winget', 'archlinux', 'fedora']);
    // The point of the type: one shape, whoever answered.
    for (const app of merged.apps) {
      expect(typeof app.name).toBe('string');
      expect(typeof app.source).toBe('string');
      expect(app).toHaveProperty('version');
    }
  });
});

describe('a broken source says so instead of returning nothing', () => {
  const cases: Array<[string, () => Promise<ProviderResult>]> = [
    ['winget', () => wingetProvider.lookup('firefox', 'app')],
    ['chocolatey', () => chocolateyProvider.lookup('firefox', 'app')],
    ['flathub', () => flathubProvider.lookup('firefox', 'app')],
    ['homebrew', () => homebrewProvider.lookup('firefox', 'app')],
    ['archlinux', () => archlinuxProvider.lookup('firefox', 'app')],
    ['aur', () => aurProvider.lookup('firefox', 'app')],
    ['debian', () => debianProvider.lookup('firefox', 'app')],
    ['ubuntu', () => ubuntuProvider.lookup('firefox', 'app')],
    ['fedora', () => fedoraProvider.lookup('firefox', 'app')],
    ['alpine', () => alpineProvider.lookup('firefox', 'app')],
    ['appimagehub', () => appimagehubProvider.lookup('firefox', 'app')],
    ['fdroid', () => fdroidProvider.lookup('firefox', 'app')],
    ['izzyondroid', () => izzyondroidProvider.lookup('dev.imranr.obtainium', 'app')],
    ['github', () => githubProvider.lookup('firefox', 'app')],
    ['scoop', () => scoopProvider.lookup('firefox', 'app')],
  ];

  for (const [name, run] of cases) {
    it(`${name} names the HTTP status rather than "no packages"`, async () => {
      const boom = httpError(403, `https://example.invalid/${name}`);
      mockedAxios.get.mockRejectedValue(boom);
      mockedAxios.post.mockRejectedValue(boom);

      const result = await run();

      expect(result.success).toBe(false);
      expect(result.error).toContain('403');
      expect(result.error).not.toMatch(/No packages matching/);
    });
  }

  it('an empty answer is still reported as an empty answer', async () => {
    routeGet({ 'archlinux.org/packages/search': { results: [] } });
    const result = await archlinuxProvider.lookup('nosuchpackage', 'app');
    expect(result.success).toBe(false);
    expect(result.error).toBe('No packages matching "nosuchpackage"');
  });

  it('nixpkgs is unconfigured, not broken, with no credentials set', () => {
    // An operator who has not pointed it at a cluster should see "unconfigured",
    // which the probe warns about and does not fail on.
    expect(nixpkgsProvider.isAvailable()).toBe(false);
  });
});

describe('the registry', () => {
  it('registers every source under a unique name', () => {
    expect(new Set(PROVIDER_NAMES).size).toBe(PROVIDER_NAMES.length);
    expect(PROVIDERS.length).toBe(PROVIDER_NAMES.length);
  });

  it('keeps github last, as the fallback source', () => {
    expect(PROVIDER_NAMES[PROVIDER_NAMES.length - 1]).toBe('github');
  });
});
