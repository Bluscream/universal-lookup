/**
 * Shared plumbing for the `app` software lookup.
 *
 * Every source here answers the same two questions — "what software matches this
 * name?" and "what version does this source have of it?" — over wildly different
 * transports: JSON APIs, OData/Atom XML, HTML tables and one bulk catalogue.
 * What they must not differ in is how they report trouble. The apk and web
 * lookups both shipped providers that caught their own exception and returned an
 * empty list, so a 403 and a genuine miss were the same answer; `failure()` and
 * `describeError()` exist so that cannot happen here.
 */

import axios, { type AxiosRequestConfig } from 'axios';
import { config } from '../../config.js';
import type { AppData, AppEntry, ProviderResult } from '../../types/common.js';

/** Sent on every request: several of these sources block an unnamed client. */
export const USER_AGENT =
  'Mozilla/5.0 (compatible; universal-lookup/1.0; +https://github.com/Bluscream/universal-lookup)';

/** How many entries a single source contributes to the combined list. */
export const PER_SOURCE_LIMIT = 10;

/**
 * Turn any thrown value into a sentence that says what actually went wrong.
 *
 * The probe classifies a row as broken by matching the error text, so the HTTP
 * status has to survive into the message — "Request failed" on its own reads as
 * an empty answer and hides a dead endpoint.
 */
export function describeError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    if (status !== undefined) {
      return `${error.config?.url ?? 'request'} returned status code ${status}`;
    }
    if (error.code) return `${error.code}: ${error.message}`;
  }
  return error instanceof Error ? error.message : String(error);
}

/** A failed ProviderResult that names its cause. */
export function failure(provider: string, start: number, error: unknown): ProviderResult<AppData> {
  return {
    provider,
    success: false,
    data: {},
    error: describeError(error),
    duration: Date.now() - start,
  };
}

/**
 * A successful ProviderResult, or an explicit empty one.
 *
 * "No packages matching X" is a real answer and must read as one — it is the
 * only case where an empty list is not a bug.
 */
export function result(
  provider: string,
  start: number,
  query: string,
  apps: AppEntry[],
  raw?: unknown,
): ProviderResult<AppData> {
  const trimmed = apps.slice(0, PER_SOURCE_LIMIT);
  return {
    provider,
    success: trimmed.length > 0,
    data: { apps: trimmed },
    raw,
    error: trimmed.length > 0 ? undefined : `No packages matching "${query}"`,
    duration: Date.now() - start,
  };
}

/** GET with the shared timeout, user agent and a caller-chosen response type. */
export async function get<T>(url: string, options?: AxiosRequestConfig): Promise<T> {
  const response = await axios.get<T>(url, {
    timeout: config.serverTimeout,
    headers: { 'User-Agent': USER_AGENT, ...options?.headers },
    ...options,
  });
  assertNotAChallengePage(url, response.data, options);
  return response.data;
}

/**
 * Catch a 200 that is not the document we asked for.
 *
 * sources.debian.org answers a JSON endpoint with a proof-of-work challenge page
 * — status 200, `text/html` — for clients it does not like. axios hands that
 * back as a string, every field reads as undefined, and the provider reported
 * "No packages matching firefox" for what was actually a block. A wrong content
 * type is a failure and has to be named as one.
 */
function assertNotAChallengePage(url: string, data: unknown, options?: AxiosRequestConfig): void {
  if (options?.responseType === 'text') return;
  if (typeof data !== 'string') return;
  if (!data.trimStart().startsWith('<')) return;
  throw new Error(`${url} returned an HTML page instead of JSON — blocked or challenged?`);
}

/** POST, for the two sources whose search endpoint takes a body. */
export async function post<T>(
  url: string,
  body: unknown,
  options?: AxiosRequestConfig,
): Promise<T> {
  const response = await axios.post<T>(url, body, {
    timeout: config.serverTimeout,
    headers: { 'User-Agent': USER_AGENT, 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  });
  return response.data;
}

/**
 * A GET that treats one status code as an answer rather than an error.
 *
 * Several of these sources use 404 to mean "no such package", which is a miss,
 * not a broken endpoint. Everything else still throws.
 */
export async function getAllowing404<T>(
  url: string,
  options?: AxiosRequestConfig,
): Promise<T | null> {
  try {
    return await get<T>(url, options);
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 404) return null;
    throw error;
  }
}

/** Whether a query looks like a reverse-DNS Android/Flatpak application id. */
export function looksLikeAppId(query: string): boolean {
  return /^[a-z][a-z0-9_]*(\.[a-z0-9_-]+){2,}$/i.test(query.trim());
}

/** Normalise a date the sources give in seconds, milliseconds or a string. */
export function toIso(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') {
    const ms = value > 1e12 ? value : value * 1000;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  // NuGet's OData feed dates are UTC but carry no offset, and Date() reads a
  // bare datetime as local time — which silently moved every Chocolatey
  // timestamp by the host's offset.
  const text = String(value);
  const bareDateTime = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(text);
  const date = new Date(bareDateTime ? `${text.replace(' ', 'T')}Z` : text);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * A bulk catalogue fetched once and reused.
 *
 * AppImageHub publishes its whole index as a 1.6 MB document and has no search
 * endpoint; downloading it per request would make the provider the slowest thing
 * in the fan-out. Cached in memory with a TTL, and a failed fetch is not cached,
 * so a transient outage does not stick.
 */
export interface Catalogue<T> {
  (): Promise<T>;
  /** Drop what is held, so the next call fetches again. Used by the tests. */
  clear(): void;
}

export function cachedCatalogue<T>(ttlMs: number, fetcher: () => Promise<T>): Catalogue<T> {
  let value: T | undefined;
  let fetchedAt = 0;
  let inFlight: Promise<T> | undefined;
  const catalogue = (async () => {
    if (value !== undefined && Date.now() - fetchedAt < ttlMs) return value;
    if (inFlight) return inFlight;
    inFlight = fetcher()
      .then((fresh) => {
        value = fresh;
        fetchedAt = Date.now();
        return fresh;
      })
      .finally(() => {
        inFlight = undefined;
      });
    return inFlight;
  }) as Catalogue<T>;
  catalogue.clear = () => {
    value = undefined;
    fetchedAt = 0;
  };
  return catalogue;
}

/** Case-insensitive substring match over the fields a catalogue search can use. */
export function matches(query: string, ...fields: Array<string | null | undefined>): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return false;
  return fields.some((field) => (field ?? '').toLowerCase().includes(needle));
}
