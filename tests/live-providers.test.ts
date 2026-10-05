import { describe, expect, it } from 'vitest';
import { isFailure, PROBED_TYPES, probeAll, type Row } from '../scripts/lib/provider-probe.js';

/**
 * Every provider and sub-provider, against a real upstream.
 *
 * Opt-in: `LIVE_PROVIDERS=1 npx vitest run tests/live-providers.test.ts`, or
 * `npm run probe` for the same thing with nicer output. It stays out of
 * `npm test` because it makes real third-party requests — a network hiccup must
 * not fail the gate that guards a commit, and the credentials it needs only
 * exist on the machines that hold them.
 *
 * What it enforces, per the three cases that matter:
 *
 *   - gated on credentials, none configured here → warn and ignore. Not every
 *     deployment configures every provider, and a machine without an Amazon
 *     login is not a broken build.
 *   - gated on credentials, configured, still failing → warn and fail, because
 *     credentials that are set and do not work is exactly the silent rot this
 *     exists to catch.
 *   - needs no credentials, failing or timing out → warn and fail.
 *
 * Every provider runs before anything fails. One dead upstream must not hide the
 * state of the other ninety-four, which is why the assertion is at the end and
 * the warnings come out as the rows land.
 */

const LIVE = process.env.LIVE_PROVIDERS === '1';
const TIMEOUT = Number(process.env.PROBE_TIMEOUT ?? 25_000);

function describeRow(row: Row): string {
  return `${row.type}/${row.provider}: ${row.state}${row.detail ? ` — ${row.detail}` : ''}`;
}

describe.runIf(LIVE)('live providers', () => {
  it(
    'every provider answers, or is unconfigured',
    async () => {
      const rows = await probeAll({
        timeout: TIMEOUT,
        // Reported as they land rather than collected: a run over ~100 providers
        // takes minutes, and a verdict that only arrives at the end tells you
        // nothing while you wait.
        onRow: (row) => {
          if (row.state !== 'ok')
            console.warn(`${isFailure(row) ? '❌' : '⚠️ '} ${describeRow(row)}`);
        },
      });

      expect(rows.length).toBeGreaterThan(0);

      const unconfigured = rows.filter((r) => r.state === 'unconfigured');
      if (unconfigured.length) {
        console.warn(
          `\n${unconfigured.length} provider(s) not configured here, ignored: ` +
            unconfigured.map((r) => `${r.type}/${r.provider}`).join(', '),
        );
      }

      // The deferred verdict. Message rather than a bare count, so a CI log says
      // which upstream broke without re-running anything.
      const failures = rows.filter(isFailure);
      expect(failures.map(describeRow)).toEqual([]);
    },
    // Sequential over every provider, each with its own timeout.
    TIMEOUT * (PROBED_TYPES.length + 100),
  );
});
