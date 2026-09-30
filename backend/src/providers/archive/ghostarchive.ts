import axios from 'axios';
import * as cheerio from 'cheerio';
import { config } from '../../config.js';
import type {
  ArchiveSnapshot,
  LookupOptions,
  LookupType,
  Provider,
  ProviderResult,
} from '../../types/common.js';
import { ARCHIVE_USER_AGENT, archiveResult, describeError, isoFromHttpDate } from './shared.js';

const SERVICE = 'ghostarchive';
const BASE_URL = 'https://ghostarchive.org';

/**
 * Ghostarchive, read-only.
 *
 * Its front page carries a plain `POST /archive2` form with a single `archive`
 * field and no token, which looks like an easy save path — but the POST is
 * served a Cloudflare interactive challenge (`cf-mitigated: challenge`,
 * HTTP 403), measured directly. Clearing that is exactly the bot check this
 * service does not defeat, and the same wall is why the allestörungen status
 * provider was switched off (see STATUS_ALLESTOERUNGEN_ENABLED). So: submission
 * is not implemented, and the provider says so when a save is asked for.
 *
 * `GET /search` is not challenged, so existing snapshots are readable.
 */
const NO_SAVE_NOTE =
  'Ghostarchive submissions are behind a Cloudflare bot challenge, which this service will not ' +
  'attempt to bypass. Existing snapshots are reported; nothing was submitted.';

/** Trailing-slash- and scheme-insensitive form, for comparing two URLs. */
function comparable(url: string): string {
  return url
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '');
}

/**
 * Snapshots from a `/search?term=` results page.
 *
 * The search is a substring match over archived URLs, so `https://example.com`
 * also returns `https://example.com.evil.test/…`. Filtering to the URL actually
 * asked about is what keeps the answer truthful.
 */
export function parseSearchResults(html: string, url: string): ArchiveSnapshot[] {
  const $ = cheerio.load(html);
  const wanted = comparable(url);
  const snapshots: ArchiveSnapshot[] = [];

  $('tr').each((_, row) => {
    const link = $(row).find('a[href^="/archive/"]').first();
    const href = link.attr('href');
    if (!href) return;
    const archivedUrl = link.text().trim();
    if (comparable(archivedUrl) !== wanted) return;
    // Columns are image, link, date, type — the date is the cell after the one
    // holding the link.
    const date = link.closest('td').next('td').text().trim();
    snapshots.push({
      service: SERVICE,
      snapshot_url: `${BASE_URL}${href}`,
      original_url: archivedUrl,
      timestamp: isoFromHttpDate(date),
      saved_now: false,
    });
  });

  return snapshots;
}

export const ghostarchive: Provider = {
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
      const resp = await axios.get<string>(`${BASE_URL}/search`, {
        params: { term: query },
        timeout: config.serverTimeout,
        responseType: 'text',
        headers: { 'User-Agent': ARCHIVE_USER_AGENT },
      });

      const snapshots = parseSearchResults(String(resp.data), query);
      return archiveResult(
        {
          service: SERVICE,
          url: query,
          saveRequested: wantsSave,
          status: wantsSave ? 'read-only' : snapshots.length ? 'existing' : 'not-archived',
          note: wantsSave ? NO_SAVE_NOTE : undefined,
          snapshots,
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
          error: `Ghostarchive: ${describeError(error)}`,
        },
        start,
      );
    }
  },
};
