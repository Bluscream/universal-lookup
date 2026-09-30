import axios from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../backend/src/config.js';
import { searxngProvider } from '../backend/src/providers/web/searxng.js';

vi.mock('axios');

const mockedGet = vi.mocked(axios.get);

const JSON_BODY = {
  results: [
    { title: 'Example Domain', url: 'https://www.example.com/', content: 'Illustrative examples.' },
    { title: '', url: 'https://no-title.example/', content: 'dropped: no title' },
    { title: 'Duplicate', url: 'https://www.example.com/', content: 'dropped: duplicate url' },
  ],
};

const HTML_BODY = `<html><body>
<article class="result result-default">
  <a href="https://www.example.com/" class="url_header"></a>
  <h3><a href="https://www.example.com/">Example Domain</a></h3>
  <p class="content">Illustrative examples.</p>
</article>
</body></html>`;

function jsonResponse(status: number, data: unknown, contentType = 'application/json') {
  return { status, data, headers: { 'content-type': contentType } };
}

let originalUrl: string;

beforeEach(() => {
  originalUrl = config.searxngUrl;
  config.searxngUrl = 'http://searxng.test:28080';
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  config.searxngUrl = originalUrl;
  vi.restoreAllMocks();
  mockedGet.mockReset();
});

describe('searxng provider', () => {
  it('parses a JSON answer into SearchResults', async () => {
    mockedGet.mockResolvedValueOnce(jsonResponse(200, JSON_BODY));

    const result = await searxngProvider.lookup('example.com', 'web');

    expect(mockedGet).toHaveBeenCalledTimes(1);
    expect(String(mockedGet.mock.calls[0]?.[0])).toContain('format=json');
    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
    // Untitled and duplicate entries are dropped; the rest keep the shared shape.
    expect(result.data.web).toEqual([
      {
        title: 'Example Domain',
        url: 'https://www.example.com/',
        description: 'Illustrative examples.',
        provider: 'searxng',
      },
    ]);
  });

  it('names search.formats when the instance has JSON disabled, then falls back to HTML', async () => {
    mockedGet
      .mockResolvedValueOnce(jsonResponse(403, '<html>Forbidden</html>', 'text/html'))
      .mockResolvedValueOnce({ status: 200, data: HTML_BODY, headers: {} });

    const result = await searxngProvider.lookup('example.com', 'web');

    expect(result.success).toBe(true);
    expect(result.data.web).toHaveLength(1);
    const raw = result.raw as { json_api_error: string; html_fallback: boolean };
    expect(raw.html_fallback).toBe(true);
    expect(raw.json_api_error).toContain('search.formats');
    expect(raw.json_api_error).toContain('HTTP 403');
  });

  it('reports the JSON refusal rather than "no results" when the HTML is empty too', async () => {
    mockedGet
      .mockResolvedValueOnce(jsonResponse(200, '<html>not json</html>', 'text/html'))
      .mockResolvedValueOnce({ status: 200, data: '<html><body></body></html>', headers: {} });

    const result = await searxngProvider.lookup('example.com', 'web');

    expect(result.success).toBe(false);
    expect(result.error).toContain('search.formats');
    expect(result.error).toContain('text/html');
  });

  it('reports a refused connection as a transport failure, not a format problem', async () => {
    mockedGet.mockRejectedValueOnce(new Error('connect ECONNREFUSED 172.17.0.1:28080'));

    const result = await searxngProvider.lookup('example.com', 'web');

    expect(result.success).toBe(false);
    expect(result.error).toContain('ECONNREFUSED');
    expect(result.error).toContain('Could not reach');
    expect(result.error).not.toContain('search.formats');
    // No point asking for the HTML page of a host that refused the connection.
    expect(mockedGet).toHaveBeenCalledTimes(1);
  });

  it('distinguishes an empty result set from a broken instance', async () => {
    mockedGet.mockResolvedValueOnce(jsonResponse(200, { results: [] }));

    const result = await searxngProvider.lookup('example.com', 'web');

    expect(result.success).toBe(false);
    expect(result.error).toContain('No results found');
  });

  it('is unavailable, and says so, when SEARXNG_URL is unset', async () => {
    config.searxngUrl = '';

    expect(searxngProvider.isAvailable()).toBe(false);
    const result = await searxngProvider.lookup('example.com', 'web');
    expect(result.success).toBe(false);
    expect(result.error).toContain('SEARXNG_URL');
    expect(mockedGet).not.toHaveBeenCalled();
  });
});
