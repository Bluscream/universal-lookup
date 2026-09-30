import axios from 'axios';
import { config } from '../../config.js';
import type {
  ArchiveSnapshot,
  LookupOptions,
  LookupType,
  Provider,
  ProviderResult,
} from '../../types/common.js';
import { ARCHIVE_USER_AGENT, archiveResult, describeError, isoFromArchiveStamp } from './shared.js';

const SERVICE = 'arquivo-pt';
const CDX_URL = 'https://arquivo.pt/wayback/cdx';
const REPLAY_URL = 'https://arquivo.pt/wayback';

/** How many snapshots to report. The CDX server will happily return thousands. */
const LIMIT = 10;

/**
 * arquivo.pt, the Portuguese web archive — read-only.
 *
 * This is here in place of the Memento TimeTravel aggregator the type was meant
 * to use: `timetravel.mementoweb.org` no longer resolves at all (NXDOMAIN; the
 * parent domain is now a GitHub Pages site), so the one API that answered "which
 * archives hold this URL?" across every archive at once is gone. arquivo.pt is
 * the closest replacement that still works — an independent, Memento- and
 * CDX-compatible archive with a broad crawl, so it genuinely widens the answer
 * rather than restating what Wayback already said.
 *
 * It has no public save endpoint: its SavePageNow lives behind the site's own
 * form, and `/services/savepage` answers 404.
 */
const NO_SAVE_NOTE = 'arquivo.pt exposes no public submission API. Existing snapshots only.';

interface CdxRow {
  timestamp?: string;
  url?: string;
  status?: string;
  mime?: string;
}

/**
 * The CDX server streams one JSON object per line rather than a JSON array, so
 * the body is parsed line by line. A line that does not parse is skipped, not
 * fatal: one malformed record should not lose the other nine.
 */
export function parseCdx(body: string, url: string): ArchiveSnapshot[] {
  const snapshots: ArchiveSnapshot[] = [];
  for (const line of body.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let row: CdxRow;
    try {
      row = JSON.parse(trimmed) as CdxRow;
    } catch {
      continue;
    }
    if (!row.timestamp) continue;
    const status = Number.parseInt(row.status ?? '', 10);
    snapshots.push({
      service: SERVICE,
      snapshot_url: `${REPLAY_URL}/${row.timestamp}/${row.url ?? url}`,
      original_url: row.url ?? url,
      timestamp: isoFromArchiveStamp(row.timestamp),
      http_status: Number.isNaN(status) ? undefined : status,
      saved_now: false,
    });
  }
  return snapshots;
}

export const arquivoPt: Provider = {
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
      const resp = await axios.get<string>(CDX_URL, {
        params: { url: query, output: 'json', limit: LIMIT },
        timeout: config.serverTimeout,
        responseType: 'text',
        headers: { 'User-Agent': ARCHIVE_USER_AGENT },
      });

      const snapshots = parseCdx(String(resp.data), query);
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
          error: `arquivo.pt: ${describeError(error)}`,
        },
        start,
      );
    }
  },
};
