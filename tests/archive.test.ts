import axios from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArchiveServiceResult, ArchiveSnapshot } from '../backend/src/types/common.js';

/**
 * The archive lookup, with the network mocked.
 *
 * Two things are being pinned here, and they are the two that make this type
 * different from every other one:
 *
 *  1. A save never happens unless it was asked for. Publishing a URL to a public
 *     archive is irreversible, so "did anything reach the network with intent to
 *     write?" is a test, not a review comment.
 *  2. No provider answers an empty result that reads like "not archived" when it
 *     actually failed. That confusion is worse here than anywhere else: it sends
 *     someone off to archive a page that is already archived, or tells them a
 *     save succeeded when the service was down.
 */

vi.mock('axios');

const mockedAxios = vi.mocked(axios, true);

const { archiveToday } = await import('../backend/src/providers/archive/archive-today.js');
const { arquivoPt } = await import('../backend/src/providers/archive/arquivo.js');
const { ghostarchive } = await import('../backend/src/providers/archive/ghostarchive.js');
const { permaCc } = await import('../backend/src/providers/archive/perma-cc.js');
const { wayback } = await import('../backend/src/providers/archive/wayback.js');
const { PROVIDER_NAMES } = await import('../backend/src/providers/archive/index.js');
const { config } = await import('../backend/src/config.js');

const URL_UNDER_TEST = 'https://example.com';

/** Route a GET by URL fragment, so a test states the whole conversation at once. */
function routeGet(handlers: Record<string, unknown>): void {
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

function snapshotsOf(data: unknown): ArchiveSnapshot[] {
  return ((data as { snapshots?: ArchiveSnapshot[] })?.snapshots ?? []) as ArchiveSnapshot[];
}

function serviceOf(data: unknown): ArchiveServiceResult | undefined {
  return (data as { archives?: ArchiveServiceResult[] })?.archives?.[0];
}

const savedKeys = { access: '', secret: '', perma: '', gap: 0 };

beforeEach(() => {
  mockedAxios.get.mockReset();
  mockedAxios.post.mockReset();
  savedKeys.access = config.iaAccessKey;
  savedKeys.secret = config.iaSecretKey;
  savedKeys.perma = config.permaCcApiKey;
  savedKeys.gap = config.archiveSaveMinGapMs;
  // The politeness gap between saves is real and deliberate, and it is also the
  // one thing here that would make the suite wait five seconds per save.
  (config as unknown as Record<string, unknown>).archiveSaveMinGapMs = 0;
});

afterEach(() => {
  // config is shared across the whole suite; a leaked credential would change
  // which branch every later test takes.
  const mutable = config as unknown as Record<string, unknown>;
  mutable.iaAccessKey = savedKeys.access;
  mutable.iaSecretKey = savedKeys.secret;
  mutable.permaCcApiKey = savedKeys.perma;
  mutable.archiveSaveMinGapMs = savedKeys.gap;
});

describe('wayback', () => {
  const AVAILABLE = {
    url: 'example.com',
    archived_snapshots: {
      closest: {
        status: '200',
        available: true,
        url: 'http://web.archive.org/web/20240101120000/https://example.com/',
        timestamp: '20240101120000',
      },
    },
  };

  it('parses the availability response into a canonical snapshot', async () => {
    routeGet({ 'wayback/available': AVAILABLE });

    const result = await wayback.lookup(URL_UNDER_TEST, 'archive');

    expect(result.success).toBe(true);
    const [snapshot] = snapshotsOf(result.data);
    expect(snapshot).toMatchObject({
      service: 'wayback',
      snapshot_url: 'http://web.archive.org/web/20240101120000/https://example.com/',
      original_url: URL_UNDER_TEST,
      timestamp: '2024-01-01T12:00:00.000Z',
      http_status: 200,
      saved_now: false,
    });
    expect(serviceOf(result.data)?.status).toBe('existing');
    expect((result.data as { archived?: boolean }).archived).toBe(true);
  });

  it('reports "not archived" without claiming a snapshot', async () => {
    routeGet({ 'wayback/available': { url: 'example.com', archived_snapshots: {} } });

    const result = await wayback.lookup(URL_UNDER_TEST, 'archive');

    expect(result.success).toBe(true);
    expect(snapshotsOf(result.data)).toEqual([]);
    expect(serviceOf(result.data)?.status).toBe('not-archived');
    // The distinction this whole type turns on: "no copy" must not be dressed up
    // as a positive answer for the merger to pick up.
    expect((result.data as { archived?: boolean }).archived).toBeUndefined();
  });

  it('says the service failed rather than answering "not archived"', async () => {
    routeGet({ 'wayback/available': new Error('Request failed with status code 503') });

    const result = await wayback.lookup(URL_UNDER_TEST, 'archive');

    expect(result.success).toBe(false);
    expect(result.error).toContain('503');
    expect(result.data).toEqual({});
  });

  it('never posts anything when save was not requested', async () => {
    routeGet({ 'wayback/available': AVAILABLE });

    await wayback.lookup(URL_UNDER_TEST, 'archive');
    await wayback.lookup(URL_UNDER_TEST, 'archive', undefined, { save: false });

    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it('refuses to save without credentials, loudly, and posts nothing', async () => {
    const mutable = config as unknown as Record<string, unknown>;
    mutable.iaAccessKey = '';
    mutable.iaSecretKey = '';
    routeGet({ 'wayback/available': AVAILABLE });

    const result = await wayback.lookup(URL_UNDER_TEST, 'archive', undefined, { save: true });

    expect(mockedAxios.post).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/IA_ACCESS_KEY/);
  });

  it('saves with credentials and reports the new snapshot as saved now', async () => {
    const mutable = config as unknown as Record<string, unknown>;
    mutable.iaAccessKey = 'test-access';
    mutable.iaSecretKey = 'test-secret';
    routeGet({
      'wayback/available': AVAILABLE,
      '/save/status/': {
        status: 'success',
        timestamp: '20240202120000',
        original_url: 'https://example.com/',
      },
    });
    mockedAxios.post.mockResolvedValue({ data: { job_id: 'job-1' }, status: 200 } as never);

    const result = await wayback.lookup(URL_UNDER_TEST, 'archive', undefined, { save: true });

    const [, , options] = mockedAxios.post.mock.calls[0] as [
      string,
      string,
      { headers: Record<string, string> },
    ];
    expect(options.headers.Authorization).toBe('LOW test-access:test-secret');
    expect(result.success).toBe(true);
    expect(serviceOf(result.data)?.status).toBe('saved');
    expect(snapshotsOf(result.data)[0]).toMatchObject({
      snapshot_url: 'https://web.archive.org/web/20240202120000/https://example.com/',
      saved_now: true,
    });
  });

  it('reports a rate-limited save as a failure, not as a success', async () => {
    const mutable = config as unknown as Record<string, unknown>;
    mutable.iaAccessKey = 'test-access';
    mutable.iaSecretKey = 'test-secret';
    routeGet({ 'wayback/available': AVAILABLE });
    mockedAxios.post.mockRejectedValue(
      Object.assign(new Error('Request failed'), {
        response: { status: 429, statusText: 'Too Many Requests' },
      }),
    );

    const result = await wayback.lookup(URL_UNDER_TEST, 'archive', undefined, { save: true });

    expect(result.success).toBe(false);
    expect(result.error).toContain('429');
    expect(snapshotsOf(result.data)).toEqual([]);
  });

  it('reports a job that failed at the archive', async () => {
    const mutable = config as unknown as Record<string, unknown>;
    mutable.iaAccessKey = 'test-access';
    mutable.iaSecretKey = 'test-secret';
    routeGet({
      'wayback/available': AVAILABLE,
      '/save/status/': { status: 'error', status_ext: 'error:blocked-url' },
    });
    mockedAxios.post.mockResolvedValue({ data: { job_id: 'job-2' }, status: 200 } as never);

    const result = await wayback.lookup(URL_UNDER_TEST, 'archive', undefined, { save: true });

    expect(result.success).toBe(false);
    expect(result.error).toContain('error:blocked-url');
  });
});

describe('archive.today', () => {
  const TIMEMAP = [
    '<https://example.com/>; rel="original",',
    '<http://archive.md/timegate/https://example.com/>; rel="timegate",',
    '<http://archive.md/19941231150000/http://example.com/>; rel="first memento"; datetime="Sat, 31 Dec 1994 15:00:00 GMT",',
    '<http://archive.md/20240101120000/http://example.com/>; rel="memento"; datetime="Mon, 01 Jan 2024 12:00:00 GMT",',
    '<http://archive.md/timemap/https://example.com/>; rel="self"; type="application/link-format"',
  ].join('\n');

  it("parses mementos and ignores the timemap's own links", async () => {
    routeGet({ 'archive.ph/timemap': TIMEMAP });

    const result = await archiveToday.lookup(URL_UNDER_TEST, 'archive');

    const snapshots = snapshotsOf(result.data);
    expect(snapshots).toHaveLength(2);
    // Newest first, and upgraded to https.
    expect(snapshots[0].snapshot_url).toBe('https://archive.md/20240101120000/http://example.com/');
    expect(snapshots[0].timestamp).toBe('2024-01-01T12:00:00.000Z');
    expect(snapshots.some((s) => s.snapshot_url.includes('timegate'))).toBe(false);
  });

  it('never submits, and says why, when a save is requested', async () => {
    routeGet({ 'archive.ph/timemap': TIMEMAP });

    const result = await archiveToday.lookup(URL_UNDER_TEST, 'archive', undefined, { save: true });

    expect(mockedAxios.post).not.toHaveBeenCalled();
    const service = serviceOf(result.data);
    expect(service?.status).toBe('read-only');
    expect(service?.note).toMatch(/CAPTCHA/i);
    // Still an answer, so the snapshots it does know about are not thrown away.
    expect(result.success).toBe(true);
    expect(snapshotsOf(result.data).length).toBeGreaterThan(0);
  });

  it('reports a bot-mitigation refusal as an error', async () => {
    routeGet({
      'archive.ph/timemap': Object.assign(new Error('Request failed'), {
        response: { status: 429, statusText: 'Too Many Requests' },
      }),
    });

    const result = await archiveToday.lookup(URL_UNDER_TEST, 'archive');

    expect(result.success).toBe(false);
    expect(result.error).toContain('429');
  });
});

describe('ghostarchive', () => {
  const SEARCH_HTML =
    '<table><tr><td>image</td><td><a href="/archive/fmPoB">https://example.com/</a></td>' +
    '<td>Thu, 17 Sep 2026 13:13:31 GMT</td></tr>' +
    // A substring hit for a different site: the search matches on substrings, so
    // this must not be reported as a snapshot of example.com.
    '<tr><td>image</td><td><a href="/archive/xxxxx">https://example.com.evil.test/</a></td>' +
    '<td>Fri, 18 Sep 2026 10:00:00 GMT</td></tr></table>';

  it('keeps only snapshots of the URL that was asked about', async () => {
    routeGet({ 'ghostarchive.org/search': SEARCH_HTML });

    const result = await ghostarchive.lookup(URL_UNDER_TEST, 'archive');

    const snapshots = snapshotsOf(result.data);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({
      service: 'ghostarchive',
      snapshot_url: 'https://ghostarchive.org/archive/fmPoB',
      timestamp: '2026-09-17T13:13:31.000Z',
    });
  });

  it('never submits, and says why, when a save is requested', async () => {
    routeGet({ 'ghostarchive.org/search': SEARCH_HTML });

    const result = await ghostarchive.lookup(URL_UNDER_TEST, 'archive', undefined, { save: true });

    expect(mockedAxios.post).not.toHaveBeenCalled();
    expect(serviceOf(result.data)?.status).toBe('read-only');
    expect(serviceOf(result.data)?.note).toMatch(/Cloudflare/i);
  });

  it('reports a Cloudflare block rather than "no snapshots"', async () => {
    routeGet({
      'ghostarchive.org/search': Object.assign(new Error('Request failed'), {
        response: { status: 403, statusText: 'Forbidden' },
      }),
    });

    const result = await ghostarchive.lookup(URL_UNDER_TEST, 'archive');

    expect(result.success).toBe(false);
    expect(result.error).toContain('403');
  });
});

describe('arquivo.pt', () => {
  const CDX = [
    '{"urlkey": "com,example)/", "timestamp": "20091014042001", "url": "http://example.com/", "status": "200"}',
    'not json at all',
    '{"urlkey": "com,example)/", "timestamp": "20150101000000", "url": "http://example.com/", "status": "200"}',
  ].join('\n');

  it('parses the line-delimited CDX stream and skips a bad line', async () => {
    routeGet({ 'arquivo.pt/wayback/cdx': CDX });

    const result = await arquivoPt.lookup(URL_UNDER_TEST, 'archive');

    const snapshots = snapshotsOf(result.data);
    expect(snapshots).toHaveLength(2);
    expect(snapshots[0]).toMatchObject({
      service: 'arquivo-pt',
      snapshot_url: 'https://arquivo.pt/wayback/20091014042001/http://example.com/',
      timestamp: '2009-10-14T04:20:01.000Z',
      http_status: 200,
    });
  });

  it('is read-only and posts nothing when asked to save', async () => {
    routeGet({ 'arquivo.pt/wayback/cdx': CDX });

    const result = await arquivoPt.lookup(URL_UNDER_TEST, 'archive', undefined, { save: true });

    expect(mockedAxios.post).not.toHaveBeenCalled();
    expect(serviceOf(result.data)?.status).toBe('read-only');
  });

  it('reports a failure instead of an empty snapshot list', async () => {
    routeGet({ 'arquivo.pt/wayback/cdx': new Error('getaddrinfo ENOTFOUND arquivo.pt') });

    const result = await arquivoPt.lookup(URL_UNDER_TEST, 'archive');

    expect(result.success).toBe(false);
    expect(result.error).toContain('ENOTFOUND');
  });
});

describe('perma.cc', () => {
  it('is unavailable without an API key, so it is skipped rather than failing', () => {
    const mutable = config as unknown as Record<string, unknown>;
    mutable.permaCcApiKey = '';
    expect(permaCc.isAvailable()).toBe(false);
  });

  it('is available with a key', () => {
    const mutable = config as unknown as Record<string, unknown>;
    mutable.permaCcApiKey = 'test-key';
    expect(permaCc.isAvailable()).toBe(true);
  });

  it('creates a link only when saving was asked for', async () => {
    const mutable = config as unknown as Record<string, unknown>;
    mutable.permaCcApiKey = 'test-key';
    routeGet({ 'api.perma.cc': { objects: [] } });

    await permaCc.lookup(URL_UNDER_TEST, 'archive');
    expect(mockedAxios.post).not.toHaveBeenCalled();

    mockedAxios.post.mockResolvedValue({
      data: { guid: 'AB12-CD34', url: URL_UNDER_TEST, creation_timestamp: '2024-03-03T00:00:00Z' },
      status: 201,
    } as never);
    const saved = await permaCc.lookup(URL_UNDER_TEST, 'archive', undefined, { save: true });

    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
    expect(snapshotsOf(saved.data)[0]).toMatchObject({
      service: 'perma-cc',
      snapshot_url: 'https://perma.cc/AB12-CD34',
      saved_now: true,
    });
  });

  it('reports a quota rejection rather than a silent no-op', async () => {
    const mutable = config as unknown as Record<string, unknown>;
    mutable.permaCcApiKey = 'test-key';
    mockedAxios.post.mockRejectedValue(
      Object.assign(new Error('Request failed'), {
        response: { status: 401, statusText: 'Unauthorized' },
      }),
    );

    const result = await permaCc.lookup(URL_UNDER_TEST, 'archive', undefined, { save: true });

    expect(result.success).toBe(false);
    expect(result.error).toContain('401');
  });
});

describe('the registry', () => {
  it('registers the five services under names nothing else uses', () => {
    expect(PROVIDER_NAMES).toEqual([
      'wayback',
      'archive-today',
      'ghostarchive',
      'arquivo-pt',
      'perma-cc',
    ]);
  });

  it('a bare URL is still detected as a url lookup, never an archive one', async () => {
    // Archiving is an outward-facing act, so it is never something auto-detection
    // decides for the caller — /archive/ has to be asked for by name.
    const { detectType } = await import('../backend/src/lib/normalizer.js');
    expect(detectType('https://example.com')).toBe('url');
    expect(detectType('example.com')).not.toBe('archive');
  });
});
