import axios from 'axios';
import { config } from '../../config.js';
import type {
  ArchiveSnapshot,
  LookupOptions,
  LookupType,
  Provider,
  ProviderResult,
} from '../../types/common.js';
import { ARCHIVE_USER_AGENT, archiveResult, describeError, isoFromHttpDate } from './shared.js';

const SERVICE = 'archive-today';
const TIMEMAP_URL = 'https://archive.ph/timemap';

/** How many of the newest mementos to report. The timemap itself is unbounded. */
const LIMIT = 10;

/**
 * archive.today (archive.ph / archive.is / archive.md), read-only.
 *
 * Its submission form is behind an interactive CAPTCHA and its ordinary pages
 * sit behind bot mitigation — a plain `/newest/` request answers HTTP 429. There
 * is no API key, no documented submission endpoint and no arrangement for
 * automated callers, so the only way to submit a URL would be to defeat the
 * check. That is not something this service will do, so saving here is simply
 * not implemented and the provider says so rather than pretending.
 *
 * Reading is a different matter: the Memento `/timemap/` endpoint is a plain,
 * unprotected, machine-readable feed, and it answers the question that matters
 * most before anyone archives anything — is there already a copy?
 *
 * The save note is deliberately in `note` and not `error`: the provider was
 * asked what it knows and it answered. Only a *failed* request is an error here.
 */
const NO_SAVE_NOTE =
  'archive.today has no automated submission path — its form is CAPTCHA-protected, which this ' +
  'service will not attempt to bypass. Existing snapshots are reported; nothing was submitted.';

/**
 * One `<url>; rel="…"; datetime="…"` line of an application/link-format timemap.
 *
 * Only memento links are of interest; `self`, `timegate` and `original` describe
 * the timemap itself. `first memento` and `last memento` are memento links too,
 * which is why the test is a substring rather than equality.
 */
const LINK_LINE = /<([^>]+)>\s*;\s*rel="([^"]*)"(?:\s*;\s*datetime="([^"]*)")?/;

export function parseTimemap(body: string, url: string): ArchiveSnapshot[] {
  const snapshots: ArchiveSnapshot[] = [];
  for (const line of body.split('\n')) {
    const match = LINK_LINE.exec(line.trim());
    if (!match) continue;
    const [, href, rel, datetime] = match;
    if (!rel.includes('memento')) continue;
    snapshots.push({
      service: SERVICE,
      // The timemap gives http:// links for a site that serves https.
      snapshot_url: href.replace(/^http:\/\//, 'https://'),
      original_url: url,
      timestamp: isoFromHttpDate(datetime),
      saved_now: false,
    });
  }
  return snapshots;
}

export const archiveToday: Provider = {
  name: SERVICE,

  isAvailable: () => true,

  async lookup(
    query: string,
    _type?: LookupType,
    _originalQuery?: string,
    options?: LookupOptions,
  ): Promise<ProviderResult> {
    const start = Date.now();
    const wantsSave = options?.save === true;
    try {
      const resp = await axios.get<string>(`${TIMEMAP_URL}/${query}`, {
        timeout: config.serverTimeout,
        responseType: 'text',
        headers: { 'User-Agent': ARCHIVE_USER_AGENT },
        // A URL with no snapshots answers 404, which is an answer, not a fault.
        validateStatus: (status) => status === 200 || status === 404,
      });

      const all = resp.status === 404 ? [] : parseTimemap(String(resp.data), query);
      // Newest first: the feed is ordered oldest-first, and the newest copy is
      // the one worth linking to. Capped because the timemap is unbounded —
      // example.com alone returns over a thousand mementos, and a response is
      // not improved by carrying all of them.
      all.reverse();
      const snapshots = all.slice(0, LIMIT);

      return archiveResult(
        {
          service: SERVICE,
          url: query,
          saveRequested: wantsSave,
          status: wantsSave ? 'read-only' : snapshots.length ? 'existing' : 'not-archived',
          note: wantsSave ? NO_SAVE_NOTE : undefined,
          snapshots,
          raw: { status: resp.status, total_mementos: all.length, reported: snapshots.length },
        },
        start,
      );
    } catch (error) {
      return archiveResult(
        {
          service: SERVICE,
          url: query,
          saveRequested: wantsSave,
          status: 'not-archived',
          error: `archive.today: ${describeError(error)}`,
        },
        start,
      );
    }
  },
};
