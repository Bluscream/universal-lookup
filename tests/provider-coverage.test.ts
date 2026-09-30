import { describe, expect, it } from 'vitest';
import { APK_MIRRORS } from '../backend/src/providers/apk/index.js';
import { LOOKUP_TYPES } from '../backend/src/types/common.js';
import {
  needsCredentials,
  PROBED_TYPES,
  PROVIDER_QUERIES,
  probeTargets,
  QUERIES,
  queryFor,
  REGISTRIES,
  UNPROBED_TYPES,
  looksBroken,
} from '../scripts/lib/provider-probe.js';

/**
 * Offline guards on the live probe.
 *
 * The probe is what answers "is every provider still working?", so a provider it
 * does not reach is a provider nobody checks — which is the situation this whole
 * layer exists to end. These tests make no network requests; they check that the
 * probe's coverage cannot quietly shrink. The live run itself is
 * tests/live-providers.test.ts and `npm run probe`.
 */
describe('the probe reaches every provider', () => {
  it('covers every lookup type, or says why not', () => {
    const covered = [...PROBED_TYPES, ...Object.keys(UNPROBED_TYPES)].sort();
    expect(covered).toEqual([...LOOKUP_TYPES].sort());
  });

  it('has a known-good query for every probed type', () => {
    const missing = PROBED_TYPES.filter((type) => !QUERIES[type]?.trim());
    expect(missing).toEqual([]);
  });

  it('gives every provider a non-empty query', () => {
    const missing = probeTargets()
      .filter(([type, p]) => !queryFor(type, p.name)?.trim())
      .map(([type, p]) => `${type}/${p.name}`);
    expect(missing).toEqual([]);
  });

  it('every per-provider query override names a provider that exists', () => {
    // A rename would otherwise leave the override in place and silently stop
    // applying, sending that provider back to the type-wide query it rejects.
    const known = probeTargets().map(([type, p]) => `${type}/${p.name}`);
    const stale = Object.keys(PROVIDER_QUERIES).filter((key) => !known.includes(key));
    expect(stale).toEqual([]);
  });

  it('runs every registered provider', () => {
    const registered = REGISTRIES.flatMap(([type, providers]) =>
      providers.map((p) => `${type}/${p.name}`),
    ).sort();
    const probed = probeTargets().map(([type, p]) => `${type}/${p.name}`);
    expect(registered.filter((name) => !probed.includes(name))).toEqual([]);
  });

  // The mirrors are the one sub-provider layer that is not a Provider: the apk
  // provider tries them in order and returns on the first hit, so probing the
  // provider alone would leave a broken mirror at position 6 undetectable.
  it('runs every apk mirror as its own row', () => {
    const probed = probeTargets(['apk']).map(([, p]) => p.name);
    for (const [mirror] of APK_MIRRORS) expect(probed).toContain(mirror);
  });

  it('probes more rows than there are providers, because of the mirrors', () => {
    const providers = REGISTRIES.reduce((n, [, ps]) => n + ps.length, 0);
    expect(probeTargets().length).toBe(providers + APK_MIRRORS.length);
  });
});

describe('credential detection', () => {
  // needsCredentials() blanks the credential-shaped config fields and asks
  // isAvailable() again, so a provider added later is classified with nothing to
  // annotate. These two pin the ends of that: one provider that is gated on an
  // API key and one that is not.
  function find(type: string, name: string) {
    const provider = REGISTRIES.find(([t]) => t === type)?.[1].find((p) => p.name === name);
    if (!provider) throw new Error(`no ${type}/${name} provider — rename?`);
    return provider;
  }

  it('sees a provider gated on an API key', () => {
    expect(needsCredentials(find('url', 'virustotal'))).toBe(true);
  });

  it('does not flag an open provider', () => {
    expect(needsCredentials(find('web', 'duckduckgo'))).toBe(false);
  });

  it('leaves config as it found it', async () => {
    // It mutates the shared config to answer the question, in the same process
    // the providers read from. A restore that missed would disable credentialed
    // providers for every test that runs after this file.
    const before = { ...(await import('../backend/src/config.js')).config };
    needsCredentials(find('url', 'virustotal'));
    expect({ ...(await import('../backend/src/config.js')).config }).toEqual(before);
  });
});

describe('failure classification', () => {
  // The distinction that decides whether a row fails the run. Getting it wrong
  // in either direction makes the probe useless: noisy, or silent.
  const broken = [
    'Timeout',
    'timed out after 25000ms',
    'Request failed with status code 403',
    'getaddrinfo ENOTFOUND api.example.com',
    'socket hang up',
    'Invalid API key',
    'rate limit exceeded',
    'threw: boom',
    // The readable forms the providers themselves produce. The first of these
    // slipped through once: improving the ip-api.io message from "Request failed
    // with status code 401" quietly reclassified five dead providers as "no data".
    'ip-api.io rejected the API key (HTTP 401) — check IP_API_IO_KEY',
    'Downdetector rejected the credentials (HTTP 403) — check DOWNDETECTOR_CLIENT_ID/SECRET',
    'google scrape failed: Chromium not found.',
    'Tried to find the browser at the configured path (/usr/local/bin/chromium), but no executable was found.',
  ];
  const notBroken = [
    'Not a special emergency number',
    'No results found',
    'Number not found in directory',
    'no download found',
  ];

  for (const error of broken) {
    it(`treats "${error}" as broken`, () => expect(looksBroken(error)).toBe(true));
  }
  for (const error of notBroken) {
    it(`treats "${error}" as an empty answer`, () => expect(looksBroken(error)).toBe(false));
  }

  it('an absent error is not broken', () => {
    expect(looksBroken(undefined)).toBe(false);
  });
});
