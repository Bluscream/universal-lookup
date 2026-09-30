import { describe, expect, it } from 'vitest';
import { config, getCacheTtl, getCacheTtlFor } from '../backend/src/config.js';

/**
 * A failed lookup must not be served back for a day.
 *
 * A /web/ lookup where all four engines timed out was cached with the ordinary
 * 24-hour TTL and then re-served as `17ms (cached)`, so the retry that would have
 * fixed it never happened and the failure outlived its cause. It is still cached
 * — every provider erroring is also what an unknown phone number looks like, and
 * re-scraping seven sites per request for that would be worse — just briefly.
 */
describe('cache TTL by outcome', () => {
  it('keeps a successful lookup for the type TTL', () => {
    for (const type of ['tel', 'web', 'parcel', 'status']) {
      expect(getCacheTtlFor(type, true)).toBe(getCacheTtl(type));
    }
  });

  it('keeps a failed lookup only briefly', () => {
    for (const type of ['tel', 'web', 'parcel', 'status']) {
      expect(getCacheTtlFor(type, false)).toBe(config.cacheTtlFailure);
    }
  });

  it('the failure TTL is much shorter than the shortest success TTL', () => {
    const shortest = Math.min(config.cacheTtl, config.cacheTtlParcel, config.cacheTtlStatus);
    expect(config.cacheTtlFailure).toBeLessThanOrEqual(shortest);
  });

  it('is positive, so a failure is still cached rather than hammered', () => {
    expect(config.cacheTtlFailure).toBeGreaterThan(0);
  });
});
