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

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** PROVIDERS_* defaults as declared in config.ts. */
function configProviderDefaults(): Map<string, string> {
  const src = readFileSync(join(ROOT, 'backend/src/config.ts'), 'utf-8');
  const found = new Map<string, string>();
  const pattern = /env\(\s*'(PROVIDERS_[A-Z]+)',\s*\n?\s*'([^']*)'/g;
  for (const m of src.matchAll(pattern)) {
    found.set(m[1], m[2]);
  }
  return found;
}

function envExampleValues(): Map<string, string> {
  const src = readFileSync(join(ROOT, '.env.example'), 'utf-8');
  const found = new Map<string, string>();
  for (const m of src.matchAll(/^(PROVIDERS_[A-Z]+)=(.*)$/gm)) {
    found.set(m[1], m[2]);
  }
  return found;
}

describe('.env.example stays in step with config.ts', () => {
  const defaults = configProviderDefaults();
  const example = envExampleValues();

  it('finds the provider lists in both files', () => {
    expect(defaults.size).toBeGreaterThan(10);
    expect(example.size).toBe(defaults.size);
  });

  // A copied .env.example is what most deployments actually run, so a provider
  // added to config.ts but not here is silently disabled for them — which is
  // exactly how the semonto provider went missing.
  for (const [key, value] of defaults) {
    it(`${key} matches`, () => {
      expect(example.get(key)).toBe(value);
    });
  }
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

describe('config.ts names only providers that exist', () => {
  const registries: Record<string, string[]> = {
    PROVIDERS_TEL: telNames,
    PROVIDERS_IP: ipNames,
    PROVIDERS_DOMAIN: domainNames,
    PROVIDERS_EMAIL: emailNames,
    PROVIDERS_LOCATION: locationNames,
    PROVIDERS_PARCEL: parcelNames,
    PROVIDERS_SHIPMENT: shipmentNames,
    PROVIDERS_STEAM: steamNames,
    PROVIDERS_URL: urlNames,
    PROVIDERS_ORDER: orderNames,
    PROVIDERS_STATUS: statusNames,
    PROVIDERS_WEB: webNames,
  };

  // A name in the default list that no provider answers to is silently dropped
  // by filterAndSortProviders — the provider just never runs, with no error.
  for (const [key, names] of Object.entries(registries)) {
    it(`${key} names are all registered`, () => {
      const configured = (configProviderDefaults().get(key) ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const registered = new Set(names.map((n) => n.toLowerCase()));
      const unknown = configured.filter((n) => !registered.has(n.toLowerCase()));
      expect(unknown).toEqual([]);
    });
  }

  it('apk mirrors are a separate list, not provider names', () => {
    // PROVIDERS_APK selects download mirrors inside the single apk provider.
    expect(apkNames).toEqual(['apk']);
  });
});
