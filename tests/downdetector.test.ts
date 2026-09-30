import axios from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../backend/src/config.js';
import {
  clearDowndetectorCache,
  hasDowndetectorCredentials,
  makeDowndetectorProvider,
  parseDowndetectorSpecs,
} from '../backend/src/providers/status/downdetector.js';
import type { StatusServiceEntry } from '../backend/src/types/common.js';

// The API is a paid subscription and its docs ask that testing not hit
// production, so every call is mocked. axios.post is the token endpoint and
// axios.get (via statusGet) is everything else.
vi.mock('axios');

const mockedAxios = vi.mocked(axios, true);

/** Route a GET by path so a test can describe the whole conversation at once. */
function routeGet(handlers: Record<string, unknown>) {
  mockedAxios.get.mockImplementation(async (url: string) => {
    for (const [fragment, data] of Object.entries(handlers)) {
      if (url.includes(fragment)) return { data, status: 200 } as never;
    }
    throw new Error(`unexpected GET ${url}`);
  });
}

const COMPANY = {
  id: 4242,
  name: 'Vodafone',
  slug: 'vodafone',
  url: 'https://xn--allestrungen-9ib.de/status/vodafone/',
  stats_24: [1, 2, 3, 40],
};

beforeEach(() => {
  clearDowndetectorCache();
  vi.clearAllMocks();
  config.downdetectorClientId = 'test-id';
  config.downdetectorClientSecret = 'test-secret';
  mockedAxios.post.mockResolvedValue({
    data: { access_token: 'jwt-token', token_type: 'Bearer' },
    status: 200,
  } as never);
  mockedAxios.isAxiosError = ((e: unknown) =>
    Boolean((e as { response?: unknown })?.response)) as never;
});

describe('parseDowndetectorSpecs', () => {
  it('parses slug=Label=icon=Category and skips duplicates and blanks', () => {
    const specs = parseDowndetectorSpecs('vodafone=Vodafone=vodafone,o2=o2,vodafone=Again,,  ');
    expect(specs).toHaveLength(2);
    expect(specs[0]).toMatchObject({
      service: 'vodafone',
      slug: 'vodafone',
      label: 'Vodafone',
      icon: 'vodafone',
    });
    expect(specs[1]).toMatchObject({ service: 'o2', label: 'o2' });
  });

  it('accepts the allestörungen spec format unchanged, so a list can be moved across', () => {
    const shared = 'congstar=congstar==Internet';
    expect(parseDowndetectorSpecs(shared)[0]).toMatchObject({
      service: 'congstar',
      category: 'Internet',
      icon: undefined,
    });
  });
});

describe('availability', () => {
  it('is unavailable without credentials, so it is skipped rather than failing', () => {
    config.downdetectorClientId = '';
    config.downdetectorClientSecret = '';
    expect(hasDowndetectorCredentials()).toBe(false);
    expect(makeDowndetectorProvider({ service: 'vodafone', slug: 'vodafone' }).isAvailable()).toBe(
      false,
    );
  });

  it('is available once both halves of the credential are set', () => {
    expect(makeDowndetectorProvider({ service: 'vodafone', slug: 'vodafone' }).isAvailable()).toBe(
      true,
    );
  });
});

describe('status mapping', () => {
  it('maps a "success" verdict to an operational service', async () => {
    routeGet({
      '/companies/search': [COMPANY],
      '/status': 'success',
      '/incidents': [],
    });
    const res = await makeDowndetectorProvider({
      service: 'vodafone',
      slug: 'vodafone',
      label: 'Vodafone',
    }).lookup('');
    expect(res.success).toBe(true);
    const svc = res.data.services?.[0] as StatusServiceEntry;
    expect(svc.indicator).toBe('none');
    expect(svc.operational).toBe(true);
  });

  it('maps "danger" to a major outage and surfaces the active incident', async () => {
    routeGet({
      '/companies/search': [COMPANY],
      '/status': 'danger',
      '/incidents': [{ id: 7, created_at: '2026-09-30T01:00:00', is_active: true, total: 1312 }],
    });
    const res = await makeDowndetectorProvider({ service: 'vodafone', slug: 'vodafone' }).lookup(
      '',
    );
    const svc = res.data.services?.[0] as StatusServiceEntry;
    expect(svc.indicator).toBe('major');
    expect(svc.operational).toBe(false);
    expect(res.data.incidents?.[0]?.name).toContain('1312');
  });

  it('maps "warning" to minor — the API scores against a baseline, unlike the scrape', async () => {
    routeGet({ '/companies/search': [COMPANY], '/status': 'warning', '/incidents': [] });
    const res = await makeDowndetectorProvider({ service: 'o2', slug: 'o2' }).lookup('');
    expect((res.data.services?.[0] as StatusServiceEntry).indicator).toBe('minor');
  });

  it('falls back to the report count when the verdict is missing', async () => {
    routeGet({ '/companies/search': [COMPANY], '/status': null, '/incidents': [] });
    // stats_24 ends at 40, over the default threshold of 10.
    const res = await makeDowndetectorProvider({ service: 'vodafone', slug: 'vodafone' }).lookup(
      '',
    );
    expect((res.data.services?.[0] as StatusServiceEntry).indicator).toBe('minor');
  });

  it('reports unknown when there is neither a verdict nor enough reports', async () => {
    routeGet({
      '/companies/search': [{ ...COMPANY, stats_24: [0, 0, 1] }],
      '/status': null,
      '/incidents': [],
    });
    const res = await makeDowndetectorProvider({ service: 'vodafone', slug: 'vodafone' }).lookup(
      '',
    );
    expect((res.data.services?.[0] as StatusServiceEntry).indicator).toBe('unknown');
  });

  it('ignores incidents the API has already resolved', async () => {
    routeGet({
      '/companies/search': [COMPANY],
      '/status': 'success',
      '/incidents': [{ id: 1, is_active: false, created_at: '2026-09-29T00:00:00' }],
    });
    const res = await makeDowndetectorProvider({ service: 'vodafone', slug: 'vodafone' }).lookup(
      '',
    );
    expect(res.data.incidents ?? []).toHaveLength(0);
  });
});

describe('token and company caching', () => {
  it('requests one token for many services rather than one each', async () => {
    routeGet({ '/companies/search': [COMPANY], '/status': 'success', '/incidents': [] });
    const a = makeDowndetectorProvider({ service: 'vodafone', slug: 'vodafone' });
    const b = makeDowndetectorProvider({ service: 'o2', slug: 'o2' });
    await Promise.all([a.lookup(''), b.lookup('')]);
    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
  });

  it('resolves a slug to a company id once even when the reading is re-fetched', async () => {
    routeGet({ '/companies/search': [COMPANY], '/status': 'success', '/incidents': [] });
    // TTL 0 makes every lookup miss the status cache, so this exercises the
    // company cache underneath rather than being masked by it.
    const originalTtl = config.downdetectorTtl;
    config.downdetectorTtl = 0;
    try {
      const provider = makeDowndetectorProvider({ service: 'vodafone', slug: 'vodafone' });
      await provider.lookup('');
      await provider.lookup('');
      const searches = mockedAxios.get.mock.calls.filter((c) =>
        String(c[0]).includes('/companies/search'),
      );
      const statuses = mockedAxios.get.mock.calls.filter((c) => String(c[0]).endsWith('/status'));
      expect(statuses).toHaveLength(2);
      expect(searches).toHaveLength(1);
    } finally {
      config.downdetectorTtl = originalTtl;
    }
  });
});

describe('error reporting', () => {
  it('names the credential variables when the API rejects auth', async () => {
    mockedAxios.get.mockRejectedValue({ response: { status: 401 } } as never);
    const res = await makeDowndetectorProvider({ service: 'vodafone', slug: 'vodafone' }).lookup(
      '',
    );
    expect(res.success).toBe(false);
    expect(res.error).toContain('DOWNDETECTOR_CLIENT_ID');
  });

  it('reports a missing company plainly', async () => {
    routeGet({ '/companies/search': [] });
    const res = await makeDowndetectorProvider({ service: 'nope', slug: 'nope' }).lookup('');
    expect(res.success).toBe(false);
    expect(res.error).toContain('No Downdetector company');
  });

  it('does not cache a failed token, so the next attempt retries it', async () => {
    mockedAxios.post.mockRejectedValueOnce(new Error('rate limited'));
    routeGet({ '/companies/search': [COMPANY], '/status': 'success', '/incidents': [] });
    const provider = makeDowndetectorProvider({ service: 'vodafone', slug: 'vodafone' });
    const first = await provider.lookup('');
    expect(first.success).toBe(false);
    mockedAxios.post.mockResolvedValue({ data: { access_token: 'jwt-2' }, status: 200 } as never);
    const second = await provider.lookup('');
    expect(second.success).toBe(true);
  });
});
