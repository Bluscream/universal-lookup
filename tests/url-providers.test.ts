import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * These cover the two bugs the live-network suite in url.test.ts was tripping
 * over but could not pin down: a DNS provider with no deadline anywhere, and a
 * metadata provider that called any non-throwing response a success.
 */

const resolvers = {
  resolve4: vi.fn(),
  resolve6: vi.fn(),
  resolveMx: vi.fn(),
  resolveTxt: vi.fn(),
  resolveNs: vi.fn(),
  resolveCname: vi.fn(),
  resolveSoa: vi.fn(),
};

vi.mock('node:dns', () => ({ promises: resolvers }));
vi.mock('axios', () => ({
  default: {
    get: vi.fn(),
    isAxiosError: (e: unknown) => !!(e as { isAxiosError?: boolean })?.isAxiosError,
  },
}));

const { config } = await import('../backend/src/config.js');
const { dnsLookupProvider } = await import('../backend/src/providers/url/dns-lookup.js');

const never = () => new Promise<never>(() => {});

describe('dns-lookup provider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Keep the test fast; the production default is 5000ms.
    config.dnsTimeout = 60;
    resolvers.resolve4.mockResolvedValue(['140.82.121.4']);
    resolvers.resolve6.mockResolvedValue(['2606:50c0::1']);
    resolvers.resolveMx.mockResolvedValue([{ priority: 10, exchange: 'mx.example.test' }]);
    resolvers.resolveTxt.mockResolvedValue([['v=spf1']]);
    resolvers.resolveNs.mockResolvedValue(['ns1.example.test']);
    resolvers.resolveCname.mockRejectedValue(new Error('ENODATA'));
    resolvers.resolveSoa.mockResolvedValue({
      nsname: 'ns1.example.test',
      hostmaster: 'hostmaster.example.test',
      serial: 1,
      refresh: 2,
      retry: 3,
      expire: 4,
      minttl: 5,
    });
  });

  it('resolves the records it can and reports the hostname', async () => {
    const result = await dnsLookupProvider.lookup('https://example.test');

    expect(result.success).toBe(true);
    expect(result.data.hostname).toBe('example.test');
    expect(result.data.dns_a).toEqual(['140.82.121.4']);
    expect(result.data.dns_mx).toEqual(['10 mx.example.test']);
  });

  it('does not hang when one record type never answers', async () => {
    // This is the bug: allSettled waits for every entry, so before the
    // per-query deadline a single stalled resolver held the whole lookup open.
    resolvers.resolve6.mockImplementation(never);
    resolvers.resolveSoa.mockImplementation(never);

    const started = Date.now();
    const result = await dnsLookupProvider.lookup('https://example.test');
    const elapsed = Date.now() - started;

    // Bounded by the per-query deadline, not by the stalled resolvers.
    expect(elapsed).toBeLessThan(2000);
    expect(result.success).toBe(true);
    // The records that did answer are still returned.
    expect(result.data.dns_a).toEqual(['140.82.121.4']);
    // The stalled ones simply contribute nothing.
    expect(result.data.dns_aaaa).toBeUndefined();
    expect(result.data.dns_soa).toBeUndefined();
  });

  it('fails cleanly when no record type answers at all', async () => {
    for (const fn of Object.values(resolvers)) fn.mockRejectedValue(new Error('ENOTFOUND'));

    const result = await dnsLookupProvider.lookup('https://nope.example.test');

    expect(result.success).toBe(false);
    expect(result.error).toBe('No DNS records found for hostname');
  });

  it('reports an unparseable URL as a failure rather than throwing', async () => {
    const result = await dnsLookupProvider.lookup('not a url');
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});

describe('metadata provider success contract', () => {
  it('does not report success for an error status', async () => {
    const axios = (await import('axios')).default;
    const { metadataProvider } = await import('../backend/src/providers/url/metadata.js');

    // A proxy error page or an upstream block: a response, but not a result.
    vi.mocked(axios.get).mockResolvedValue({
      status: 400,
      headers: { 'content-type': 'text/plain' },
      data: 'Bad Request',
      request: { res: { responseUrl: 'https://example.test' } },
    });

    const result = await metadataProvider.lookup('https://example.test');

    // Previously this was success: true with meta: null, so a caller reading
    // data.meta.title crashed.
    expect(result.success).toBe(false);
    expect(result.error).toContain('400');
    expect(result.data.meta ?? null).toBeNull();
  });
});
