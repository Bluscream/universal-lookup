/**
 * Pieces every archive provider needs.
 *
 * The one rule this module exists to hold: a provider reports what actually
 * happened, and a provider that could not reach its service says so in `error`.
 * An archive lookup answering `{}` with no error reads exactly like "this URL
 * is not archived anywhere", which is the most misleading answer this type can
 * give — someone would go and archive a page that was already archived, or
 * trust that a save happened when it did not.
 */

import type {
  ArchiveData,
  ArchiveSaveState,
  ArchiveServiceResult,
  ArchiveSnapshot,
  ProviderResult,
} from '../../types/common.js';

/** Sent on every archive request: these services all want a nameable caller. */
export const ARCHIVE_USER_AGENT =
  'Mozilla/5.0 (compatible; universal-lookup/1.0; +https://github.com/Bluscream/universal-lookup)';

/**
 * A 14-digit `yyyyMMddHHmmss` archive timestamp as ISO 8601.
 *
 * Wayback, arquivo.pt and archive.today all stamp their snapshots this way, in
 * UTC. Returns undefined rather than an Invalid Date for anything else, so a
 * format change upstream shows up as a missing timestamp instead of `null` that
 * a client would render as a date.
 */
export function isoFromArchiveStamp(stamp: string | undefined | null): string | undefined {
  if (!stamp) return undefined;
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(stamp.trim());
  if (!m) return undefined;
  const parsed = Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`);
  // Round-tripped through Date so it comes out in exactly the same form as
  // isoFromHttpDate's — one timestamp format across every service, not two that
  // differ by whether milliseconds are printed.
  return Number.isNaN(parsed) ? undefined : new Date(parsed).toISOString();
}

/** An HTTP-date (`Sat, 31 Dec 1994 15:00:00 GMT`) as ISO 8601. */
export function isoFromHttpDate(value: string | undefined | null): string | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : new Date(parsed).toISOString();
}

/**
 * Serialize saves across every provider, with a gap between them.
 *
 * Save Page Now is slow by design and blocks a caller that hammers it, and a
 * /archive/ lookup fans out to every provider at once — so without this, one
 * request would fire a save at each service simultaneously and a handful of
 * requests would get the whole deployment rate-limited. Module-level on purpose:
 * the queue has to span providers, not sit inside one.
 */
let saveChain: Promise<void> = Promise.resolve();

export function queueSave<T>(task: () => Promise<T>, minGapMs: number): Promise<T> {
  const result = saveChain.then(task);
  // The chain must not break when a save fails, and must not hold the failure:
  // an unhandled rejection here would take the process down.
  saveChain = result.then(
    () => sleep(minGapMs),
    () => sleep(minGapMs),
  );
  return result;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

/** The error message for a thrown value, with axios's response status kept. */
export function describeError(error: unknown): string {
  if (error && typeof error === 'object' && 'response' in error) {
    const response = (error as { response?: { status?: number; statusText?: string } }).response;
    if (response?.status) {
      return `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`;
    }
  }
  return error instanceof Error ? error.message : String(error);
}

interface ArchiveAnswer {
  service: string;
  status: ArchiveSaveState;
  /** The URL the lookup was about. */
  url: string;
  /** Whether this request asked for the URL to be published. */
  saveRequested: boolean;
  note?: string;
  snapshots?: ArchiveSnapshot[];
  raw?: unknown;
  /** Set when the service could not be reached or answered unusably. */
  error?: string;
}

/**
 * Build the ProviderResult for one service.
 *
 * `success` is true when the service answered the question, including "no, this
 * URL is not archived here" — that is an answer. It is false only when the
 * service could not be asked, and then `error` says why.
 */
export function archiveResult(answer: ArchiveAnswer, start: number): ProviderResult<ArchiveData> {
  const snapshots = answer.snapshots ?? [];
  const service: ArchiveServiceResult = {
    service: answer.service,
    status: answer.status,
    note: answer.note,
    snapshots,
  };
  const data: ArchiveData = {
    original_url: answer.url,
    save_requested: answer.saveRequested,
    archives: [service],
    snapshots,
  };
  // Never `archived: false` — the merger keeps the first non-empty value, so one
  // service answering "not here" would otherwise speak for all of them.
  if (snapshots.length > 0) data.archived = true;

  return {
    provider: answer.service,
    success: answer.error === undefined,
    data: answer.error === undefined ? data : {},
    raw: answer.raw,
    error: answer.error,
    duration: Date.now() - start,
  };
}
