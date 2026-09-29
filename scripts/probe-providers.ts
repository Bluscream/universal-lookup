/**
 * Live provider probe.
 *
 * The unit suite mocks the network, which is right for a gate but means a
 * provider can rot silently: an upstream changes its HTML, revokes a key or
 * moves an endpoint, and nothing fails until someone looks. 36 of 60 provider
 * implementations had no test of any kind, and 12 of the 16 that need
 * credentials had none — so there was no way to answer "is every provider
 * still working?" at all.
 *
 * This answers it, on a machine that actually holds the credentials. For every
 * registered provider it reports one of:
 *
 *   ok        the lookup succeeded
 *   FAIL      the provider is configured and available, but the lookup failed
 *   skip      isAvailable() is false — no credentials configured for it
 *
 * Exit status is non-zero when anything FAILed, so it can gate a release. A
 * `skip` never fails the run: not every deployment configures every provider.
 *
 * Usage:
 *   npx tsx scripts/probe-providers.ts                 # everything
 *   npx tsx scripts/probe-providers.ts tel ip          # only these types
 *   npx tsx scripts/probe-providers.ts --json          # machine-readable
 *   PROBE_TIMEOUT=20000 npx tsx scripts/probe-providers.ts
 *
 * It makes real requests to third parties. It is deliberately NOT part of
 * `npm test`.
 */

import { PROVIDERS as apk } from '../backend/src/providers/apk/index.js';
import { PROVIDERS as domain } from '../backend/src/providers/domain/index.js';
import { PROVIDERS as email } from '../backend/src/providers/email/index.js';
import { PROVIDERS as ip } from '../backend/src/providers/ip/index.js';
import { PROVIDERS as location } from '../backend/src/providers/location/index.js';
import { PROVIDERS as order } from '../backend/src/providers/order/index.js';
import { PROVIDERS as parcel } from '../backend/src/providers/parcel/index.js';
import { PROVIDERS as shipment } from '../backend/src/providers/shipment/index.js';
import { PROVIDERS as status } from '../backend/src/providers/status/index.js';
import { PROVIDERS as steam } from '../backend/src/providers/steam/index.js';
import { PROVIDERS as tel } from '../backend/src/providers/tel/index.js';
import { PROVIDERS as url } from '../backend/src/providers/url/index.js';
import { PROVIDERS as web } from '../backend/src/providers/web/index.js';
import type { Provider } from '../backend/src/types/common.js';

/**
 * One known-good query per lookup type. These are deliberately boring, stable
 * public values — a provider failing on them is the provider's problem, not the
 * query's.
 */
const QUERIES: Record<string, string> = {
  tel: '004930399760', // AVM's own published number
  ip: '1.1.1.1',
  domain: 'example.com',
  email: 'postmaster@example.com',
  location: 'Mainz, Germany',
  url: 'https://example.com',
  web: 'example.com',
  status: 'github',
  steam: '76561197960435530', // Valve's own well-known test account
  apk: 'com.android.chrome',
  parcel: '1Z999AA10123456784', // UPS's documented sample tracking number
  shipment: 'TBA000000000000',
  order: '000-0000000-0000000',
};

const REGISTRIES: Array<[string, Provider[]]> = [
  ['tel', tel],
  ['ip', ip],
  ['domain', domain],
  ['email', email],
  ['location', location],
  ['url', url],
  ['web', web],
  ['status', status],
  ['steam', steam],
  ['apk', apk],
  ['parcel', parcel],
  ['shipment', shipment],
  ['order', order],
];

const TIMEOUT = Number(process.env.PROBE_TIMEOUT ?? 25_000);

interface Row {
  type: string;
  provider: string;
  state: 'ok' | 'FAIL' | 'no-data' | 'skip';
  ms: number;
  detail?: string;
}

/**
 * Tell a broken provider from one that simply has nothing for this query.
 *
 * `success: false` means both things in this codebase, and conflating them
 * makes the probe useless: the emergency provider correctly reports
 * "Not a special emergency number" for an ordinary number, while tellows
 * answering 403 is a provider that has stopped working. Only the second kind
 * should fail a run, so an error is a real failure when it looks like
 * transport, auth or rate limiting rather than an empty result.
 */
const BROKEN = [
  /status code (4\d\d|5\d\d)/i,
  /\btimed? ?out\b/i,
  /ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN|ETIMEDOUT|CERT_|socket hang up/i,
  /unauthor|forbidden|invalid (api )?key|quota|rate ?limit|captcha|blocked/i,
  /\bthrew\b/i,
];

function classify(error: string | undefined): 'FAIL' | 'no-data' {
  if (!error) return 'no-data';
  return BROKEN.some((re) => re.test(error)) ? 'FAIL' : 'no-data';
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`probe timed out after ${ms}ms`)), ms);
    timer.unref?.();
  });
  return Promise.race([p, deadline]).finally(() => clearTimeout(timer)) as Promise<T>;
}

async function probe(type: string, provider: Provider): Promise<Row> {
  const started = Date.now();

  // isAvailable() is how a provider declares its credentials are present, so a
  // false here is "not configured", never a failure.
  let available: boolean;
  try {
    available = provider.isAvailable();
  } catch (error) {
    return {
      type,
      provider: provider.name,
      state: 'FAIL',
      ms: Date.now() - started,
      detail: `isAvailable() threw: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  if (!available) {
    return { type, provider: provider.name, state: 'skip', ms: 0, detail: 'not configured' };
  }

  try {
    const result = await withTimeout(provider.lookup(QUERIES[type], type as never), TIMEOUT);
    const detail = result.success ? undefined : (result.error ?? 'reported success: false');
    return {
      type,
      provider: provider.name,
      state: result.success ? 'ok' : classify(detail),
      ms: Date.now() - started,
      detail,
    };
  } catch (error) {
    return {
      type,
      provider: provider.name,
      state: 'FAIL',
      ms: Date.now() - started,
      detail: `threw: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`,
    };
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const asJson = args.includes('--json');
  const wanted = args.filter((a) => !a.startsWith('--'));
  const registries = wanted.length
    ? REGISTRIES.filter(([t]) => wanted.includes(t))
    : REGISTRIES.filter(([t]) => QUERIES[t] !== undefined);

  if (!registries.length) {
    console.error(`No such type. Known: ${REGISTRIES.map(([t]) => t).join(', ')}`);
    process.exit(2);
  }

  const rows: Row[] = [];
  for (const [type, providers] of registries) {
    // Sequential on purpose: a parallel fan-out across every provider trips
    // rate limits and makes a failure hard to attribute.
    for (const provider of providers) {
      const row = await probe(type, provider);
      rows.push(row);
      if (!asJson) {
        const mark =
          row.state === 'ok'
            ? '✅'
            : row.state === 'skip'
              ? '⏭️ '
              : row.state === 'no-data'
                ? '◻️ '
                : '❌';
        const ms = row.state === 'skip' ? '' : `${row.ms}ms`;
        console.log(
          `${mark} ${type.padEnd(9)} ${row.provider.padEnd(26)} ${ms.padStart(7)}` +
            (row.detail ? `  ${row.detail}` : ''),
        );
      }
    }
  }

  const failed = rows.filter((r) => r.state === 'FAIL');
  const ok = rows.filter((r) => r.state === 'ok');
  const noData = rows.filter((r) => r.state === 'no-data');
  const skipped = rows.filter((r) => r.state === 'skip');

  if (asJson) {
    console.log(JSON.stringify({ rows, ok: ok.length, failed: failed.length }, null, 2));
  } else {
    console.log(
      `\n${ok.length} ok · ${noData.length} no data · ${failed.length} failed · ` +
        `${skipped.length} skipped (not configured)`,
    );
    if (skipped.length) {
      console.log(`\nNot configured: ${skipped.map((r) => `${r.type}/${r.provider}`).join(', ')}`);
    }
    if (failed.length) {
      console.log('\nFailures:');
      for (const r of failed) console.log(`  ${r.type}/${r.provider}: ${r.detail}`);
    }
  }

  process.exit(failed.length ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
