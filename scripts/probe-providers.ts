/**
 * Live provider probe — CLI.
 *
 * Runs every registered provider, and every apk download mirror, against a
 * known-good query for its lookup type, then reports one line each. The
 * classification and the reason it exists are in scripts/lib/provider-probe.ts.
 *
 * Every row is reported. Nothing is skipped silently, and one bad provider never
 * stops the rest: the failures are collected and the run exits non-zero at the
 * end, so this can gate a release.
 *
 *   ✅ ok            the lookup succeeded
 *   ◻️  no data       answered, nothing for this query — warned, does not fail
 *   ⏭️  unconfigured  no credentials on this machine — warned, does not fail
 *   ❌ auth-failed   configured with credentials, and still failed — FAILS
 *   ❌ failed        needs no credentials, and failed or timed out — FAILS
 *
 * Usage:
 *   npm run probe                      # everything
 *   npm run probe -- tel ip            # only these types
 *   npm run probe -- --json            # machine-readable
 *   PROBE_TIMEOUT=20000 npm run probe
 *
 * It makes real requests to third parties, so it is deliberately not part of
 * `npm test`. `LIVE_PROVIDERS=1 npx vitest run tests/live-providers.test.ts`
 * runs the same probe inside the suite.
 */

import { type Row, PROBED_TYPES, isFailure, probeAll } from './lib/provider-probe.js';

const MARKS: Record<Row['state'], string> = {
  ok: '✅',
  'no-data': '◻️ ',
  unconfigured: '⏭️ ',
  'auth-failed': '❌',
  failed: '❌',
};

function print(row: Row): void {
  const ms = row.state === 'unconfigured' ? '' : `${row.ms}ms`;
  const state = row.state === 'ok' ? '' : ` [${row.state}]`;
  console.log(
    `${MARKS[row.state]} ${row.type.padEnd(9)} ${row.provider.padEnd(26)} ${ms.padStart(7)}` +
      `${state}${row.detail ? `  ${row.detail}` : ''}`,
  );
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const asJson = args.includes('--json');
  const wanted = args.filter((a) => !a.startsWith('--'));

  const unknown = wanted.filter((t) => !PROBED_TYPES.includes(t));
  if (unknown.length) {
    console.error(`No such type: ${unknown.join(', ')}. Known: ${PROBED_TYPES.join(', ')}`);
    process.exit(2);
  }

  const rows = await probeAll({
    types: wanted,
    timeout: Number(process.env.PROBE_TIMEOUT ?? 25_000),
    onRow: asJson ? undefined : print,
  });

  const count = (state: Row['state']) => rows.filter((r) => r.state === state).length;
  const failures = rows.filter(isFailure);

  if (asJson) {
    console.log(JSON.stringify({ rows, failed: failures.length }, null, 2));
  } else {
    console.log(
      `\n${count('ok')} ok · ${count('no-data')} no data · ` +
        `${count('unconfigured')} unconfigured · ${failures.length} failed`,
    );
    const unconfigured = rows.filter((r) => r.state === 'unconfigured');
    if (unconfigured.length) {
      console.log(
        `\nNot configured here (ignored): ${unconfigured
          .map((r) => `${r.type}/${r.provider}`)
          .join(', ')}`,
      );
    }
    if (failures.length) {
      console.log('\nFailures:');
      for (const r of failures) {
        const gate = r.state === 'auth-failed' ? ' (credentials are set)' : '';
        console.log(`  ${r.type}/${r.provider}${gate}: ${r.detail}`);
      }
    }
  }

  process.exit(failures.length ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
