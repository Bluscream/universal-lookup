import { describe, expect, it } from 'vitest';
import { collectErrors, collectRaw, mergeResponses } from '../src/lib/merger.js';
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

  it('merges, deduplicates, and sorts parcel events oldest-first', () => {
    const results: ProviderResult[] = [
      {
        provider: 'dhl',
        success: true,
        data: {
          events: [
            { date: '2026-05-27T08:00:00Z', status: 'Delivered', source: 'dhl' },
            { date: '2026-05-27T07:00:00Z', status: 'In Transit', source: 'dhl' },
          ],
        },
        duration: 100,
      },
      {
        provider: 'pkge',
        success: true,
        data: {
          events: [
            { date: '2026-05-27T07:00:00Z', status: 'In Transit', source: 'pkge' },
            { date: '2026-05-27T06:00:00Z', status: 'Picked Up', source: 'pkge' },
          ],
        },
        duration: 50,
      },
    ];
    const merged = mergeResponses(results);
    expect(merged.events).toBeDefined();
    const events = merged.events as any[];
    expect(events.length).toBe(3);
    // Oldest-to-newest sorting
    expect(events[0].status).toBe('Picked Up');
    expect(events[0].date).toBe('2026-05-27T06:00:00Z');
    expect(events[1].status).toBe('In Transit');
    expect(events[1].date).toBe('2026-05-27T07:00:00Z');
    // First source wins in duplicate matching
    expect(events[1].source).toBe('dhl');
    expect(events[2].status).toBe('Delivered');
    expect(events[2].date).toBe('2026-05-27T08:00:00Z');
  });

  it('merges and deduplicates couriers keeping the last item as active', () => {
    const results: ProviderResult[] = [
      { provider: 'dhl', success: true, data: { couriers: ['dhl', 'usps'] }, duration: 100 },
      { provider: 'pkge', success: true, data: { couriers: ['dhl', 'fedex'] }, duration: 50 },
    ];
    const merged = mergeResponses(results);
    expect(merged.couriers).toEqual(['dhl', 'usps', 'fedex']);
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
