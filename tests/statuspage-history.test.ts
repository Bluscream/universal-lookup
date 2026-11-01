import { describe, expect, it } from 'vitest';
import {
  incidentsToHistory,
  pageOrigin,
  showcaseToHistory,
} from '../backend/src/providers/status/statuspage-history.js';

describe('statuspage history', () => {
  it('derives the page origin from a summary.json URL', () => {
    expect(pageOrigin('https://www.githubstatus.com/api/v2/summary.json')).toBe(
      'https://www.githubstatus.com',
    );
  });

  it('takes the worst component per day from uptime_showcase', () => {
    const h = showcaseToHistory({
      timelines: {
        a: {
          days: [
            { date: '2026-10-01', outages: { m: 8640 } },
            { date: '2026-10-02', outages: {} },
          ],
        },
        b: {
          days: [
            { date: '2026-10-01', outages: { p: 86400 } },
            { date: '2026-10-02', outages: {} },
          ],
        },
      },
      values: [
        { thirty: 99.5, ninety: 99.9 },
        { thirty: 98, ninety: 99.2 },
      ],
    });
    // a: 10% major down -> 90; b: full-day partial at 30% weight -> 70.
    expect(h.history).toEqual([
      { date: '2026-10-01', ratio: 70, label: 'degraded' },
      { date: '2026-10-02', ratio: 100, label: 'excellent' },
    ]);
    expect(h.uptime30d).toBe(98);
    expect(h.uptime90d).toBe(99.2);
  });

  it('builds days from incidents and weights by impact', () => {
    const now = Date.parse('2026-10-03T00:00:00Z');
    const h = incidentsToHistory(
      [
        {
          impact: 'major',
          created_at: '2026-10-01T00:00:00Z',
          resolved_at: '2026-10-01T06:00:00Z',
        },
        { impact: 'none', created_at: '2026-10-02T00:00:00Z', resolved_at: '2026-10-02T23:00:00Z' },
      ],
      now,
    );
    const byDate = new Map(h.history.map((p) => [p.date, p.ratio]));
    expect(byDate.get('2026-10-01')).toBe(75);
    expect(byDate.get('2026-10-02')).toBe(100);
    expect(h.history).toHaveLength(90);
  });

  it('limits a full incident feed to the span it covers', () => {
    const now = Date.parse('2026-10-10T12:00:00Z');
    const incidents = Array.from({ length: 50 }, () => ({
      impact: 'minor',
      created_at: '2026-10-08T00:00:00Z',
      resolved_at: '2026-10-08T00:00:01Z',
    }));
    const h = incidentsToHistory(incidents, now);
    expect(h.history.map((p) => p.date)).toEqual(['2026-10-08', '2026-10-09', '2026-10-10']);
  });

  it('merges overlapping incidents and caps stale open ones', () => {
    const now = Date.parse('2026-10-20T00:00:00Z');
    const h = incidentsToHistory(
      [
        {
          impact: 'minor',
          created_at: '2026-10-01T00:00:00Z',
          resolved_at: '2026-10-01T12:00:00Z',
        },
        {
          impact: 'minor',
          created_at: '2026-10-01T00:00:00Z',
          resolved_at: '2026-10-01T12:00:00Z',
        },
        {
          impact: 'major',
          created_at: '2026-10-01T00:00:00Z',
          resolved_at: '2026-10-01T06:00:00Z',
        },
        {
          impact: 'major',
          status: 'monitoring',
          created_at: '2026-10-05T00:00:00Z',
          updated_at: '2026-10-05T00:00:00Z',
        },
      ],
      now,
    );
    const byDate = new Map(h.history.map((p) => [p.date, p.ratio]));
    // 6h major + 6h minor-only at 30%: 100 - (6 + 1.8) / 24 * 100.
    expect(byDate.get('2026-10-01')).toBe(67.5);
    expect(byDate.get('2026-10-05')).toBe(0);
    expect(byDate.get('2026-10-06')).toBe(100);
  });
});
