import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A web engine must say why it returned nothing.
 *
 * `/api/web/<query>` answered `{"google":"Timeout","bing":"Timeout",…}` and, on
 * another run, four identical "No results found" — both times the real cause was
 * that the browser never started. The scrape helper caught the exception, logged
 * it to the container log and returned an empty array, so every engine reported
 * the same thing whether it had searched and found nothing or had not searched at
 * all. Those are different answers and the response has to distinguish them.
 */

const scrapeWithPuppeteer = vi.fn();
vi.mock('../backend/src/lib/puppeteer.js', () => ({ scrapeWithPuppeteer }));

const { bingProvider, duckduckgoProvider, googleProvider, yahooProvider } = await import(
  '../backend/src/providers/web/index.js'
);
const { config } = await import('../backend/src/config.js');

const ENGINES = [
  ['google', googleProvider],
  ['bing', bingProvider],
  ['duckduckgo', duckduckgoProvider],
  ['yahoo', yahooProvider],
] as const;

describe('web search reports the real failure', () => {
  beforeEach(() => {
    scrapeWithPuppeteer.mockReset();
    // Otherwise google takes the official-API path and never scrapes.
    config.googleApiKey = '';
    config.googleSearchCx = '';
  });

  for (const [name, provider] of ENGINES) {
    it(`${name} names the browser failure instead of "No results found"`, async () => {
      scrapeWithPuppeteer.mockRejectedValue(new Error('Chromium not found.'));

      const result = await provider.lookup('example.com', 'web');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Chromium not found.');
      expect(result.error).not.toBe('No results found');
    });

    it(`${name} still says "No results found" when the page had none`, async () => {
      scrapeWithPuppeteer.mockResolvedValue('<html><body>nothing here</body></html>');

      const result = await provider.lookup('example.com', 'web');

      expect(result.success).toBe(false);
      expect(result.error).toBe('No results found');
    });
  }

  it('succeeds with no error when the page has results', async () => {
    scrapeWithPuppeteer.mockResolvedValue(
      '<html><body><div class="b_algo"><h2>Example</h2>' +
        '<a href="https://example.com">Example</a>' +
        '<div class="b_caption"><p>A description</p></div></div></body></html>',
    );

    const result = await bingProvider.lookup('example.com', 'web');

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.data.web?.[0]?.url).toBe('https://example.com/');
  });
});
