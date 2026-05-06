import { describe, it, expect } from 'vitest';
import { mergeResponses, collectErrors, collectRaw } from '../src/lib/merger.js';
import type { ProviderResult } from '../src/types/common.js';

describe('mergeResponses', () => {
  it('merges data from multiple providers', () => {
    const results: ProviderResult[] = [
      { provider: 'a', success: true, data: { country: 'US', city: 'NYC' }, duration: 100 },
      { provider: 'b', success: true, data: { country: 'US', isp: 'Comcast' }, duration: 50 },
    ];
    const merged = mergeResponses(results);
    expect(merged.country).toBe('US');
    expect(merged.city).toBe('NYC');
    expect(merged.isp).toBe('Comcast');
  });

  it('first provider wins for conflicting keys', () => {
    const results: ProviderResult[] = [
      { provider: 'a', success: true, data: { city: 'New York' }, duration: 100 },
      { provider: 'b', success: true, data: { city: 'NYC' }, duration: 50 },
    ];
    const merged = mergeResponses(results);
    expect(merged.city).toBe('New York');
  });

  it('normalizes key names', () => {
    const results: ProviderResult[] = [
      { provider: 'a', success: true, data: { countryCode: 'US' }, duration: 100 },
    ];
    const merged = mergeResponses(results);
    expect(merged.country_code).toBe('US');
    expect(merged.countryCode).toBeUndefined();
  });

  it('skips empty/null values', () => {
    const results: ProviderResult[] = [
      { provider: 'a', success: true, data: { city: null, country: '' }, duration: 100 },
      { provider: 'b', success: true, data: { city: 'Berlin', country: 'Germany' }, duration: 50 },
    ];
    const merged = mergeResponses(results);
    expect(merged.city).toBe('Berlin');
    expect(merged.country).toBe('Germany');
  });

  it('skips failed providers', () => {
    const results: ProviderResult[] = [
      { provider: 'a', success: false, data: { city: 'Bad' }, error: 'failed', duration: 100 },
      { provider: 'b', success: true, data: { city: 'Good' }, duration: 50 },
    ];
    const merged = mergeResponses(results);
    expect(merged.city).toBe('Good');
  });
});

describe('collectErrors', () => {
  it('collects errors from failed providers', () => {
    const results: ProviderResult[] = [
      { provider: 'a', success: true, data: {}, duration: 100 },
      { provider: 'b', success: false, data: {}, error: 'timeout', duration: 100 },
      { provider: 'c', success: false, data: {}, error: 'rate limited', duration: 0 },
    ];
    const errors = collectErrors(results);
    expect(errors).toEqual({ b: 'timeout', c: 'rate limited' });
  });
});

describe('collectRaw', () => {
  it('collects raw responses from all providers', () => {
    const results: ProviderResult[] = [
      { provider: 'a', success: true, data: {}, raw: { foo: 1 }, duration: 100 },
      { provider: 'b', success: true, data: {}, raw: { bar: 2 }, duration: 50 },
    ];
    const raw = collectRaw(results);
    expect(raw.a).toEqual({ foo: 1 });
    expect(raw.b).toEqual({ bar: 2 });
  });
});
