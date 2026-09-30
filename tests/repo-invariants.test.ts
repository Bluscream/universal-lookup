import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PROVIDER_NAMES as apkNames } from '../backend/src/providers/apk/index.js';
import { PROVIDER_NAMES as domainNames } from '../backend/src/providers/domain/index.js';
import { PROVIDER_NAMES as emailNames } from '../backend/src/providers/email/index.js';
import { PROVIDER_NAMES as ipNames } from '../backend/src/providers/ip/index.js';
import { PROVIDER_NAMES as locationNames } from '../backend/src/providers/location/index.js';
import { PROVIDER_NAMES as orderNames } from '../backend/src/providers/order/index.js';
import { PROVIDER_NAMES as parcelNames } from '../backend/src/providers/parcel/index.js';
import { PROVIDER_NAMES as shipmentNames } from '../backend/src/providers/shipment/index.js';
import { PROVIDER_NAMES as statusNames } from '../backend/src/providers/status/index.js';
import { PROVIDER_NAMES as steamNames } from '../backend/src/providers/steam/index.js';
import { PROVIDER_NAMES as telNames } from '../backend/src/providers/tel/index.js';
import { PROVIDER_NAMES as urlNames } from '../backend/src/providers/url/index.js';
import { PROVIDER_NAMES as webNames } from '../backend/src/providers/web/index.js';
import { LOOKUP_TYPES } from '../backend/src/types/common.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Every file that used to carry a per-type PROVIDERS_* allowlist. */
const CONFIG_SURFACES = [
  'backend/src/config.ts',
  '.env.example',
  'unraid/universal-lookup.xml',
  'unraid/universal-lookup-tailscale.xml',
];

describe('provider selection is one blacklist', () => {
  // The thirteen PROVIDERS_* allowlists had to restate every provider name, so
  // a provider added to a registry but not to all four files below silently
  // never ran — which is how the semonto provider went missing. Nothing should
  // reintroduce one.
  for (const file of CONFIG_SURFACES) {
    it(`${file} names no PROVIDERS_* allowlist`, () => {
      const src = readFileSync(join(ROOT, file), 'utf-8');
      const found = [...src.matchAll(/PROVIDERS_[A-Z]+/g)]
        .map((m) => m[0])
        .filter((name) => name !== 'PROVIDERS_BLACKLIST');
      expect([...new Set(found)]).toEqual([]);
    });

    it(`${file} documents PROVIDERS_BLACKLIST`, () => {
      expect(readFileSync(join(ROOT, file), 'utf-8')).toContain('PROVIDERS_BLACKLIST');
    });
  }

  it('defaults to empty, so everything registered runs', () => {
    const config = readFileSync(join(ROOT, 'backend/src/config.ts'), 'utf-8');
    expect(config).toMatch(/providersBlacklist: env\('PROVIDERS_BLACKLIST', ''\)/);
    expect(readFileSync(join(ROOT, '.env.example'), 'utf-8')).toMatch(/^PROVIDERS_BLACKLIST=$/m);
  });
});

describe('web search lives only in the web provider', () => {
  // The four engines used to be appended to seven other registries as
  // "fallbacks", so a tel lookup with no hit returned a page of Google links
  // dressed as provider results. They answer /web/ and nothing else now.
  const ENGINES = ['google', 'bing', 'duckduckgo', 'yahoo'];
  const elsewhere: Array<[string, string[]]> = [
    ['tel', telNames],
    ['ip', ipNames],
    ['domain', domainNames],
    ['email', emailNames],
    ['location', locationNames],
    ['parcel', parcelNames],
    ['shipment', shipmentNames],
  ];

  it('registers the engines under web', () => {
    expect(webNames).toEqual(expect.arrayContaining(ENGINES));
  });

  for (const [type, names] of elsewhere) {
    it(`${type} registers none of them`, () => {
      expect(names.filter((n) => ENGINES.includes(n.toLowerCase()))).toEqual([]);
    });
  }
});

describe('the flat blacklist namespace', () => {
  const REGISTRIES: Record<string, string[]> = {
    tel: telNames,
    ip: ipNames,
    domain: domainNames,
    email: emailNames,
    location: locationNames,
    parcel: parcelNames,
    shipment: shipmentNames,
    steam: steamNames,
    url: urlNames,
    apk: apkNames,
    order: orderNames,
    status: statusNames,
    web: webNames,
  };

  function canonical(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  /** canonical provider name -> the lookup types that register it. */
  function byName(): Map<string, string[]> {
    const out = new Map<string, string[]>();
    for (const [type, names] of Object.entries(REGISTRIES)) {
      for (const name of names) {
        const key = canonical(name);
        out.set(key, [...(out.get(key) ?? []), type]);
      }
    }
    return out;
  }

  // One list covers every registry, so a name in two of them is disabled in
  // both by a bare entry. That is the intent for these four — whois is whois
  // wherever it runs — and `ip:whois` still narrows it to one. Pinning the set
  // means a new, unintended collision fails here instead of surprising someone.
  it('shares only the names that are deliberately the same provider', () => {
    const shared = [...byName().entries()]
      .filter(([, types]) => types.length > 1)
      .map(([name, types]) => `${name}: ${types.sort().join(',')}`)
      .sort();
    expect(shared).toEqual([
      'amazon: order,shipment',
      'dns: domain,ip',
      'subdomain: domain,ip',
      'whois: domain,ip',
    ]);
  });

  // A name that is both a lookup type and a provider is the one genuine
  // ambiguity in a flat list, which is why `type:` and `<type>:` scopes exist.
  it('names the providers that collide with a lookup type', () => {
    const names = byName();
    const collisions = LOOKUP_TYPES.filter((t) => names.has(t)).map(
      (t) => `${t} (provider in: ${names.get(t)?.join(',')})`,
    );
    expect(collisions).toEqual([
      // Disambiguate with status:steam or type:steam.
      'steam (provider in: status)',
      // Harmless: the apk registry's only provider IS the apk lookup.
      'apk (provider in: apk)',
    ]);
  });

  it('apk mirrors are a separate list, not provider names', () => {
    expect(apkNames).toEqual(['apk']);
  });
});

const SOURCE_DIRS = ['backend/src', 'common/src', 'frontend/src', 'tests'];
const HARD_LIMIT = 1000;
const SPLIT_POINT = 600;

function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (/\.(ts|tsx)$/.test(entry)) {
        out.push(full);
      }
    }
  };
  for (const dir of SOURCE_DIRS) walk(join(ROOT, dir));
  return out;
}

describe('source file size', () => {
  const measured = sourceFiles()
    .map((path) => ({
      path: relative(ROOT, path),
      lines: readFileSync(path, 'utf-8').split('\n').length,
    }))
    .sort((a, b) => b.lines - a.lines);

  it(`no file exceeds ${HARD_LIMIT} lines`, () => {
    const over = measured
      .filter((f) => f.lines > HARD_LIMIT)
      .map((f) => `${f.path} — ${f.lines} lines`);
    expect(over).toEqual([]);
  });

  it(`names files past the ${SPLIT_POINT}-line split point`, () => {
    // Not a failure: surfaces the seam while splitting is still cheap.
    const approaching = measured.filter((f) => f.lines > SPLIT_POINT);
    for (const f of approaching) {
      console.warn(`note: ${f.path} is ${f.lines} lines, approaching the ${HARD_LIMIT} limit`);
    }
    expect(measured.length).toBeGreaterThan(0);
  });
});
