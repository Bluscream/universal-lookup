import { describe, expect, it } from 'vitest';
import { dnsLookupProvider } from '../src/providers/url/dns-lookup.js';
import { metadataProvider } from '../src/providers/url/metadata.js';

describe('DNS Lookup Provider', () => {
  it('resolves standard A and AAAA records for github.com', async () => {
    const result = await dnsLookupProvider.lookup('https://github.com');
    expect(result.success).toBe(true);
    expect(result.data.hostname).toBe('github.com');
    expect(result.data.dns_a).toBeDefined();
    expect(Array.isArray(result.data.dns_a)).toBe(true);
  });
});

describe('HTTP Metadata Scraper Provider', () => {
  it('scrapes HTML meta headers and tracks redirects', async () => {
    const result = await metadataProvider.lookup('https://github.com');
    expect(result.success).toBe(true);
    expect(result.data.landing_url).toContain('github.com');
    expect(result.data.ssl).toBeDefined();
    expect(result.data.ssl.subject).toBeDefined();
    expect(result.data.meta).toBeDefined();
    expect(result.data.meta.title).toContain('GitHub');
  });
});
