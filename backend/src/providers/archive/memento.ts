/**
 * One provider for every archive that speaks RFC 7089.
 *
 * A surprising number of web archives — the national ones especially — run the
 * same OpenWayback/pywb software and therefore answer the same
 * `GET <base>/<url>` with an `application/link-format` timemap. That means the
 * difference between supporting one of them and supporting five is a base URL
 * and a name, and writing a bespoke provider per archive would be copying the
 * same twenty lines of link parsing around.
 *
 * So the parsing lives here once and each archive is a few lines of
 * configuration. What is deliberately *not* shared is the reason a given
 * archive cannot be saved to: that differs per service and is the thing a
 * caller most needs to be told accurately, so every archive states its own.
 */

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

/**
 * One `<url>; rel="…"; datetime="…"` entry of an application/link-format
 * timemap.
 *
 * Only memento links are of interest; `self`, `timegate` and `original`
 * describe the timemap itself. `first memento` and `last memento` are memento
 * links too, which is why the test below is a substring rather than equality.
 */
const LINK_LINE = /<([^>]+)>\s*;\s*rel="([^"]*)"(?:\s*;\s*datetime="([^"]*)")?/;

export interface MementoArchiveOptions {
  /** The provider name, and the `service` on every snapshot it returns. */
  service: string;
  /** Fetched as `${timemapBase}/${query}`. */
  timemapBase: string;
  /**
   * Why this archive cannot be saved to, in the caller's terms. Reported as a
   * `note` rather than an `error`, because "I cannot publish here, and here is
   * what I did find" is an answer to the question that was asked.
   */
  saveNote: string;
  /** Prefixed to any error, so a merged response says which service failed. */
  label: string;
  /** How many of the newest mementos to report. Timemaps are unbounded. */
  limit?: number;
  /**
   * Rewrite `http://` snapshot links to `https://`. Some archives emit http
   * links for hosts that serve https, and handing back a link that immediately
   * redirects is worse than fixing it here.
   */
  upgradeToHttps?: boolean;
}

const DEFAULT_LIMIT = 10;

/**
 * Every memento in a timemap body, oldest first — the order the feed uses.
 *
 * A line that does not parse is skipped rather than fatal: one malformed record
 * should not lose the others.
 */
export function parseLinkFormatTimemap(
  body: string,
  options: { service: string; url: string; upgradeToHttps?: boolean },
): ArchiveSnapshot[] {
  const snapshots: ArchiveSnapshot[] = [];
  // Entries are comma-separated and archives disagree about whether they also
  // put each one on its own line, so split on both and let the regex decide.
  for (const entry of body.split(/,\s*(?=<)|\n/)) {
    const match = LINK_LINE.exec(entry.trim());
    if (!match) continue;
    const [, href, rel, datetime] = match;
    if (!rel.includes('memento')) continue;
    snapshots.push({
      service: options.service,
      snapshot_url: options.upgradeToHttps ? href.replace(/^http:\/\//, 'https://') : href,
      original_url: options.url,
      timestamp: isoFromHttpDate(datetime),
      saved_now: false,
    });
  }
  return snapshots;
}

/** A read-only provider for one RFC 7089 archive. */
export function createMementoProvider(options: MementoArchiveOptions): Provider {
  const limit = options.limit ?? DEFAULT_LIMIT;

  return {
    name: options.service,

    // Reading needs no credentials anywhere in this family, so the provider is
    // always available; only saving is unavailable, and it says so when asked.
    isAvailable: () => true,

    async lookup(
      query: string,
      _type?: LookupType,
      _originalQuery?: string,
      lookupOptions?: LookupOptions,
    ): Promise<ProviderResult> {
      const start = Date.now();
      const wantsSave = lookupOptions?.save === true;
      try {
        const resp = await axios.get<string>(`${options.timemapBase}/${query}`, {
          timeout: config.serverTimeout,
          responseType: 'text',
          headers: { 'User-Agent': ARCHIVE_USER_AGENT },
          // A URL with no snapshots answers 404 with an empty body. That is the
          // archive answering "no", not a fault, so it must not become an error
          // — but it must also not be confused with a 404 from anything else,
          // which is why only these two statuses are allowed through.
          validateStatus: (status) => status === 200 || status === 404,
        });

        const all =
          resp.status === 404
            ? []
            : parseLinkFormatTimemap(String(resp.data), {
                service: options.service,
                url: query,
                upgradeToHttps: options.upgradeToHttps,
              });
        // Newest first: the feed is ordered oldest-first and the newest copy is
        // the one worth linking to. Capped because the timemap is unbounded —
        // example.com alone returns thousands of mementos from these archives,
        // and a response is not improved by carrying all of them.
        all.reverse();
        const snapshots = all.slice(0, limit);

        return archiveResult(
          {
            service: options.service,
            url: query,
            saveRequested: wantsSave,
            status: wantsSave ? 'read-only' : snapshots.length ? 'existing' : 'not-archived',
            note: wantsSave ? options.saveNote : undefined,
            snapshots,
            raw: { status: resp.status, total_mementos: all.length, reported: snapshots.length },
          },
          start,
        );
      } catch (error) {
        // Reached on a timeout, a connection reset, or any status that is not
        // 200/404 — including a bot-mitigation 403. All of those mean the
        // question went unanswered, and an unanswered question here reads
        // exactly like "not archived anywhere", so it has to surface as error.
        return archiveResult(
          {
            service: options.service,
            url: query,
            saveRequested: wantsSave,
            status: 'not-archived',
            error: `${options.label}: ${describeError(error)}`,
          },
          start,
        );
      }
    },
  };
}
