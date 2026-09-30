/**
 * The live provider probe, as a library.
 *
 * The unit suite mocks the network, which is right for a gate but means a
 * provider can rot silently: an upstream changes its HTML, revokes a key or
 * moves an endpoint, and nothing fails until someone looks. That is how a /web/
 * lookup came to answer `{"google":"Timeout","bing":"Timeout",…}` for weeks with
 * a full green test run behind it.
 *
 * This module runs every registered provider — and every apk mirror, which is
 * the one sub-provider layer that is not a Provider — against a known-good query
 * and classifies the outcome. `scripts/probe-providers.ts` is the CLI over it;
 * `tests/provider-coverage.test.ts` checks offline that nothing escapes it, and
 * `tests/live-providers.test.ts` runs it under vitest on demand.
 *
 * The rule the classification exists to encode: a provider that is simply not
 * configured on this machine is not a failure, and everything else is — but only
 * after every provider has had its turn, never by aborting the run.
 */

import { config, ensureDataDir } from '../../backend/src/config.js';
import { initDatabase } from '../../backend/src/db/migrations.js';
import { APK_MIRRORS, PROVIDERS as apk } from '../../backend/src/providers/apk/index.js';
import { PROVIDERS as domain } from '../../backend/src/providers/domain/index.js';
import { PROVIDERS as email } from '../../backend/src/providers/email/index.js';
import { PROVIDERS as ip } from '../../backend/src/providers/ip/index.js';
import { PROVIDERS as location } from '../../backend/src/providers/location/index.js';
import { PROVIDERS as order } from '../../backend/src/providers/order/index.js';
import { PROVIDERS as parcel } from '../../backend/src/providers/parcel/index.js';
import { PROVIDERS as shipment } from '../../backend/src/providers/shipment/index.js';
import { PROVIDERS as shorten } from '../../backend/src/providers/shorten/index.js';
import { PROVIDERS as status } from '../../backend/src/providers/status/index.js';
import { PROVIDERS as steam } from '../../backend/src/providers/steam/index.js';
import { PROVIDERS as tel } from '../../backend/src/providers/tel/index.js';
import { PROVIDERS as url } from '../../backend/src/providers/url/index.js';
import { PROVIDERS as web } from '../../backend/src/providers/web/index.js';
import { LOOKUP_TYPES } from '../../backend/src/types/common.js';
import type { Provider, ProviderResult } from '../../backend/src/types/common.js';

/**
 * One known-good query per lookup type. Deliberately boring, stable public
 * values — a provider failing on these is the provider's problem, not the
 * query's.
 */
export const QUERIES: Record<string, string> = {
  tel: '004930399760', // AVM's own published number
  ip: '1.1.1.1',
  domain: 'example.com',
  email: 'postmaster@example.com',
  location: 'Mainz, Germany',
  url: 'https://example.com',
  // Shortening is a write: this creates a real short link on every service it
  // probes, so the target has to be something harmless that is already
  // shortened a thousand times a day.
  shorten: 'https://example.com',
  web: 'example.com',
  status: 'github',
  steam: '76561197960435530', // Valve's own well-known test account
  apk: 'com.android.chrome',
  parcel: '1Z999AA10123456784', // UPS's documented sample tracking number
  // The shipment provider takes an order number, `orderId::trackingNumber`, or a
  // tracking URL — a bare TBA number was rejected as malformed, which is not a
  // test of anything.
  shipment: '000-0000000-0000000',
  order: '000-0000000-0000000',
};

/**
 * Per-provider query overrides, keyed `type/provider`.
 *
 * One query per type is right for providers that answer the same question, but
 * some validate a format only they accept and reject anything else before making
 * a request — which tests nothing at all. These give those providers a key of the
 * shape they want. The values need not identify a real parcel or order: a
 * well-formed key that comes back "not found" still exercises the provider,
 * whereas a malformed one only exercises its format check.
 */
export const PROVIDER_QUERIES: Record<string, string> = {
  'parcel/amazon-tba': 'TBA000000000000',
  'order/aliexpress': '8000000000000000', // 16 digits, which is all it checks for
};

/** The query a given provider is probed with. */
export function queryFor(type: string, provider: string): string {
  return PROVIDER_QUERIES[`${type}/${provider}`] ?? QUERIES[type];
}

export const REGISTRIES: Array<[string, Provider[]]> = [
  ['tel', tel],
  ['ip', ip],
  ['domain', domain],
  ['email', email],
  ['location', location],
  ['url', url],
  ['shorten', shorten],
  ['web', web],
  ['status', status],
  ['steam', steam],
  ['apk', apk],
  ['parcel', parcel],
  ['shipment', shipment],
  ['order', order],
];

/** Every lookup type the probe covers. `auto` resolves to one of these. */
export const PROBED_TYPES = REGISTRIES.map(([type]) => type);

/** Lookup types that are not probed, and why. */
export const UNPROBED_TYPES: Record<string, string> = {
  auto: 'not a registry — resolves to one of the others',
};

/**
 * The apk download mirrors, presented as probeable providers.
 *
 * They are reached only through the single `apk` provider, which tries them in
 * order and returns on the first hit, so a broken mirror at position 6 is
 * invisible to a probe of the provider. Wrapping each one gives it its own row.
 */
export function mirrorProviders(): Provider[] {
  return APK_MIRRORS.map(([name, download]) => ({
    name,
    isAvailable: () => true,
    async lookup(query: string): Promise<ProviderResult> {
      const start = Date.now();
      try {
        const downloads = await download(query);
        return {
          provider: name,
          success: downloads.length > 0,
          data: { downloads },
          error: downloads.length > 0 ? undefined : 'no download found',
          duration: Date.now() - start,
        };
      } catch (error) {
        return {
          provider: name,
          success: false,
          data: {},
          error: error instanceof Error ? error.message : String(error),
          duration: Date.now() - start,
        };
      }
    },
  }));
}

/** Everything the probe runs, as `[type, provider]` pairs in registry order. */
export function probeTargets(types?: string[]): Array<[string, Provider]> {
  const wanted = types?.length ? types : PROBED_TYPES;
  const out: Array<[string, Provider]> = [];
  for (const [type, providers] of REGISTRIES) {
    if (!wanted.includes(type)) continue;
    for (const provider of providers) out.push([type, provider]);
    // Mirrors belong to the apk lookup, so they run with it and nowhere else.
    if (type === 'apk') for (const mirror of mirrorProviders()) out.push([type, mirror]);
  }
  return out;
}

/**
 * Config fields that hold credentials.
 *
 * Used to tell an authenticated provider from an open one without asking every
 * provider to declare it: blank these, ask `isAvailable()` again, and a provider
 * that changes its mind was gated on credentials. Deriving it means a provider
 * added later is classified correctly with no annotation to forget.
 */
const CREDENTIAL_FIELD =
  /key|secret|token|signature|password|pass$|username|user$|cookie|clientid/i;

/**
 * Whether `provider` needs credentials to run at all.
 *
 * Restores config before returning, including when `isAvailable()` throws — the
 * probe shares one process with the providers it is asking about.
 */
export function needsCredentials(provider: Provider): boolean {
  const mutable = config as unknown as Record<string, unknown>;
  const saved: Array<[string, unknown]> = [];
  for (const [field, value] of Object.entries(mutable)) {
    if (typeof value === 'string' && value !== '' && CREDENTIAL_FIELD.test(field)) {
      saved.push([field, value]);
      mutable[field] = '';
    }
  }
  try {
    return !provider.isAvailable();
  } catch {
    // An isAvailable() that throws is a failure, not a credential question; the
    // probe reports it as one. Say "no" here so the row is not mislabelled.
    return false;
  } finally {
    for (const [field, value] of saved) mutable[field] = value;
  }
}

/**
 * The outcomes, and what each one does to the run:
 *
 *   ok           the lookup succeeded
 *   no-data      answered, with nothing for this query — warn, passes
 *   unconfigured isAvailable() is false, no credentials here — warn, passes
 *   auth-failed  needs credentials, has them, and failed — warn, FAILS the run
 *   failed       needs nothing, and failed or timed out — warn, FAILS the run
 */
export type State = 'ok' | 'no-data' | 'unconfigured' | 'auth-failed' | 'failed';

/** The two states that fail a run — collected to the end, never thrown early. */
export const FAILING_STATES: State[] = ['auth-failed', 'failed'];

export interface Row {
  type: string;
  provider: string;
  state: State;
  ms: number;
  /** True when the provider is gated on credentials, however it turned out. */
  authed: boolean;
  detail?: string;
}

export function isFailure(row: Row): boolean {
  return FAILING_STATES.includes(row.state);
}

/**
 * Tell a broken provider from one that simply has nothing for this query.
 *
 * `success: false` means both things in this codebase, and conflating them makes
 * the probe useless: the emergency provider correctly reports "Not a special
 * emergency number" for an ordinary number, while tellows answering 403 is a
 * provider that has stopped working. Only the second kind fails a run, so an
 * error counts as broken when it looks like transport, auth or rate limiting
 * rather than an empty result.
 */
const BROKEN = [
  /status code (4\d\d|5\d\d)/i,
  // A provider that turns a status code into a readable message — "rejected the
  // API key (HTTP 401)" — must still read as broken. Improving one of those
  // messages silently downgraded five failing providers to "no data".
  /\(HTTP (4\d\d|5\d\d)\)/i,
  /rejected the (api )?key|rejected the credentials/i,
  /\btimed? ?out\b/i,
  /\btimeout\b/i,
  /ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN|ETIMEDOUT|CERT_|socket hang up/i,
  /unauthor|forbidden|invalid (api )?key|quota|rate ?limit|captcha|blocked/i,
  /\bthrew\b/i,
  // A missing browser is an environment failure, not an empty answer: every
  // puppeteer-backed provider reports it, and they all read as "nothing found"
  // unless it is called what it is.
  /chromium not found|no executable was found|failed to launch|scrape failed/i,
];

export function looksBroken(error: string | undefined): boolean {
  return error !== undefined && BROKEN.some((re) => re.test(error));
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`probe timed out after ${ms}ms`)), ms);
    timer.unref?.();
  });
  return Promise.race([p, deadline]).finally(() => clearTimeout(timer)) as Promise<T>;
}

/** Run one provider against its type's known-good query. Never throws. */
export async function probe(type: string, provider: Provider, timeout: number): Promise<Row> {
  const started = Date.now();
  const base = { type, provider: provider.name };

  let authed = false;
  let available: boolean;
  try {
    available = provider.isAvailable();
    authed = needsCredentials(provider);
  } catch (error) {
    return {
      ...base,
      state: 'failed',
      authed: false,
      ms: Date.now() - started,
      detail: `isAvailable() threw: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  // isAvailable() is how a provider declares its credentials are present, so a
  // false here is "not configured on this machine" — warned about, never failed.
  if (!available) {
    return {
      ...base,
      state: 'unconfigured',
      authed,
      ms: 0,
      detail: authed ? 'no credentials configured' : 'disabled by config',
    };
  }

  try {
    const query = queryFor(type, provider.name);
    const result = await withTimeout(provider.lookup(query, type as never), timeout);
    if (result.success) return { ...base, state: 'ok', authed, ms: Date.now() - started };
    const detail = result.error ?? 'reported success: false with no error';
    const broken = looksBroken(detail);
    return {
      ...base,
      state: broken ? (authed ? 'auth-failed' : 'failed') : 'no-data',
      authed,
      ms: Date.now() - started,
      detail,
    };
  } catch (error) {
    return {
      ...base,
      state: authed ? 'auth-failed' : 'failed',
      authed,
      ms: Date.now() - started,
      detail: `threw: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`,
    };
  }
}

/**
 * Probe everything, reporting each row as it lands.
 *
 * Sequential on purpose: a parallel fan-out across every provider trips rate
 * limits and makes a failure impossible to attribute. `onRow` is what makes the
 * run legible while it is still going — the aggregate verdict is the caller's.
 */
export async function probeAll(options?: {
  types?: string[];
  timeout?: number;
  onRow?: (row: Row) => void;
}): Promise<Row[]> {
  // The same deadline the server itself gives a provider: one that cannot answer
  // inside SERVER_TIMEOUT is not working in production either.
  const timeout = options?.timeout ?? config.serverTimeout;
  // The providers are written against a running server, and some of them reach
  // for the database — the Amazon ones save their session cookies there. Without
  // this the first of those throws "Database not initialized" outside the awaited
  // chain and takes the whole process down, losing every row after it.
  ensureDataDir();
  await initDatabase();
  const rows: Row[] = [];
  for (const [type, provider] of probeTargets(options?.types)) {
    const row = await probe(type, provider, timeout);
    rows.push(row);
    options?.onRow?.(row);
  }
  return rows;
}

export { LOOKUP_TYPES };
