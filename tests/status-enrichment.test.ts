import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  companyToSummary,
  extractCompany,
  metricsOf,
  parseServiceSpecs,
} from '../backend/src/providers/status/allestoerungen.js';
import {
  type StatusEnricher,
  type StatusEnrichment,
  withEnrichers,
} from '../backend/src/providers/status/enrich.js';
import {
  isWithinWindow,
  parseMaintenanceSpecs,
} from '../backend/src/providers/status/maintenance.js';
import { clearIncidentCache } from '../backend/src/providers/status/statuspage.js';
import type { StatusServiceEntry } from '../backend/src/types/common.js';

beforeEach(() => {
  clearIncidentCache();
  vi.useRealTimers();
});

describe('allestoerungen (crowd-sourced reports)', () => {
  const URL = 'https://xn--allestrungen-9ib.de/en/status/call-of-duty/';

  /** Build a chart of 15-minute buckets, newest last. */
  const points = (pairs: Array<[number, number]>) =>
    pairs.map(([reportsValue, baselineValue], i) => ({
      timestampUtc: new Date(Date.UTC(2026, 6, 24, 10, i * 15)).toISOString(),
      reportsValue,
      baselineValue,
    }));

  const company = (status: string, pairs: Array<[number, number]>) => ({
    name: 'Call of Duty',
    slug: 'call-of-duty',
    category: { name: 'Games' },
    stats: { status, chartData: { dataPoints: points(pairs) } },
  });

  it('extracts the company carrying chart data out of a Next.js flight payload', () => {
    const withStats = {
      __typename: 'CompanyType',
      name: 'Call of Duty',
      slug: 'call-of-duty',
      stats: {
        __typename: 'CompanyStatsType',
        status: 'danger',
        chartData: { dataPoints: [{ timestampUtc: 't', reportsValue: 5, baselineValue: 1 }] },
      },
    };
    // A trending-list entry (no chart) precedes the page's actual subject.
    const trending = { __typename: 'CompanyType', name: 'Other', slug: 'other' };
    const inner = `["$","div",null,{"a":${JSON.stringify(trending)},"b":${JSON.stringify(withStats)}}]`;
    const html = `<script>self.__next_f.push([1,${JSON.stringify(inner)}])</script>`;

    const found = extractCompany(html);
    expect(found?.slug).toBe('call-of-duty');
    expect(found?.stats?.status).toBe('danger');
  });

  it('returns null when the page carries no company data', () => {
    expect(extractCompany('<html><body>Just a moment...</body></html>')).toBeNull();
  });

  it('maps a green page to operational with no incidents', () => {
    const summary = companyToSummary(
      company('success', [
        [2, 3],
        [1, 3],
      ]),
      URL,
    );
    expect(summary.status?.indicator).toBe('none');
    expect(summary.status?.description).toBe('All Systems Operational');
    expect(summary.incidents).toEqual([]);
  });

  it('maps danger to a major outage with a single stable incident', () => {
    const summary = companyToSummary(
      company('danger', [
        [1, 1],
        [200, 1],
      ]),
      URL,
    );
    expect(summary.status?.indicator).toBe('major');
    expect(summary.status?.description).toBe('Major Service Outage');
    expect(summary.incidents).toHaveLength(1);
    const incident = summary.incidents?.[0];
    expect(incident?.name).toBe('User reports indicate problems');
    // Null so consumers diffing polls don't see a fresh update every 15 min.
    expect(incident?.updated_at).toBeNull();
  });

  it('maps warning to a minor outage', () => {
    expect(
      companyToSummary(
        company('warning', [
          [1, 1],
          [50, 1],
        ]),
        URL,
      ).status?.indicator,
    ).toBe('minor');
  });

  it('dates the incident from when reports first became elevated', () => {
    // Quiet, quiet, then three elevated buckets: the outage began at the first.
    const summary = companyToSummary(
      company('danger', [
        [1, 1],
        [2, 1],
        [90, 1],
        [120, 1],
        [110, 1],
      ]),
      URL,
    );
    expect(summary.incidents?.[0]?.started_at).toBe(
      points([
        [0, 0],
        [0, 0],
        [0, 0],
      ])[2].timestampUtc,
    );
  });

  it('suppresses an outage flag that is below the noise floor', () => {
    // Flagged by the site, but only 3 reports — under the default minimum of 10.
    const summary = companyToSummary(
      company('danger', [
        [1, 0],
        [3, 0],
      ]),
      URL,
    );
    expect(summary.status?.indicator).toBe('none');
    expect(summary.incidents).toEqual([]);
  });

  it('falls back to the chart when the site reports no status', () => {
    expect(
      companyToSummary(
        company('', [
          [1, 1],
          [400, 1],
        ]),
        URL,
      ).status?.indicator,
    ).toBe('minor');
    expect(
      companyToSummary(
        company('', [
          [1, 1],
          [1, 1],
        ]),
        URL,
      ).status?.indicator,
    ).toBe('unknown');
  });

  it('reports the current and peak volume for the window', () => {
    expect(
      metricsOf(
        company('danger', [
          [5, 1],
          [900, 1],
          [210, 1],
        ]),
      ),
    ).toMatchObject({
      reports: 210,
      baseline: 1,
      peak: 900,
    });
  });

  it('parses service specs with optional label and icon overrides', () => {
    expect(parseServiceSpecs('call-of-duty=Call of Duty=activision, sparkasse ,,')).toEqual([
      { service: 'call-of-duty', slug: 'call-of-duty', label: 'Call of Duty', icon: 'activision' },
      { service: 'sparkasse', slug: 'sparkasse', label: undefined, icon: undefined },
    ]);
    expect(parseServiceSpecs('')).toEqual([]);
    // Duplicates collapse so one slug can't register two providers.
    expect(parseServiceSpecs('steam,steam')).toHaveLength(1);
  });
});

describe('enrichment (cross-provider signal injection)', () => {
  const entry = (over: Partial<StatusServiceEntry> = {}): StatusServiceEntry => ({
    service: 'steam',
    name: 'Steam',
    indicator: 'none',
    status: 'All Systems Operational',
    operational: true,
    maintenance: false,
    maintainance: false,
    active_incidents: 0,
    ...over,
  });

  const provider = (data: unknown, ok = true): Provider => ({
    name: 'steam',
    isAvailable: () => true,
    lookup: async () => ({ provider: 'steam', success: ok, data, raw: { base: 1 }, duration: 0 }),
  });

  const enricher = (enrichment: StatusEnrichment | null, name = 'crowd'): StatusEnricher => ({
    name,
    enrich: async () => enrichment,
  });

  it('escalates a service and appends the incident', async () => {
    const wrapped = withEnrichers(provider({ services: [entry()], incidents: [] }), [
      enricher({
        indicator: 'major',
        incidents: [{ service: 'steam', name: 'User reports indicate problems' }],
        raw: { reports: 200 },
      }),
    ]);

    const result = await wrapped.lookup('steam');
    const svc = (result.data as { services: StatusServiceEntry[] }).services[0];
    expect(svc.indicator).toBe('major');
    expect(svc.operational).toBe(false);
    expect(svc.status).toBe('Major Service Outage');
    expect(svc.active_incidents).toBe(1);
    expect((result.data as { incidents: unknown[] }).incidents).toHaveLength(1);
    // Enricher detail is namespaced under raw, leaving the provider's own intact.
    expect(result.raw).toMatchObject({ base: 1, crowd: { reports: 200 } });
  });

  it('never downgrades a provider that already reports something worse', async () => {
    const wrapped = withEnrichers(
      provider({
        services: [entry({ indicator: 'critical', status: 'Total Outage', operational: false })],
        incidents: [],
      }),
      [enricher({ indicator: 'minor' })],
    );

    const svc = ((await wrapped.lookup('steam')).data as { services: StatusServiceEntry[] })
      .services[0];
    expect(svc.indicator).toBe('critical');
    expect(svc.status).toBe('Total Outage');
    expect(svc.operational).toBe(false);
  });

  it('only enriches the entry that is the provider itself', async () => {
    // The Steam provider also reports CS2; CS2 must be left alone.
    const wrapped = withEnrichers(
      provider({
        services: [entry(), entry({ service: 'cs2', name: 'Counter-Strike 2' })],
        incidents: [],
      }),
      [enricher({ indicator: 'major' })],
    );

    const services = ((await wrapped.lookup('steam')).data as { services: StatusServiceEntry[] })
      .services;
    expect(services[0].indicator).toBe('major');
    expect(services[1].indicator).toBe('none');
  });

  it('ignores an enricher that knows nothing or throws', async () => {
    const exploding: StatusEnricher = {
      name: 'boom',
      enrich: async () => {
        throw new Error('upstream down');
      },
    };
    const wrapped = withEnrichers(provider({ services: [entry()], incidents: [] }), [
      enricher(null),
      exploding,
    ]);

    const result = await wrapped.lookup('steam');
    expect(result.success).toBe(true);
    expect((result.data as { services: StatusServiceEntry[] }).services[0].indicator).toBe('none');
  });

  it('passes a failed provider result straight through', async () => {
    const wrapped = withEnrichers(provider({}, false), [enricher({ indicator: 'major' })]);
    expect((await wrapped.lookup('steam')).success).toBe(false);
  });
});

describe('scheduled maintenance enricher', () => {
  const window = { utcDay: 2, utcHourStart: 23, utcHourEnd: 24 }; // Tuesday 23:00 UTC

  it('detects a window that wraps past midnight', () => {
    const wrap = { utcDay: 2, utcHourStart: 22, utcHourEnd: 2 };
    // Tuesday 23:00 — inside.
    expect(isWithinWindow(wrap, new Date(Date.UTC(2026, 6, 21, 23)))).toBe(true);
    // Wednesday 01:00 — still inside, on the far side of midnight.
    expect(isWithinWindow(wrap, new Date(Date.UTC(2026, 6, 22, 1)))).toBe(true);
    // Wednesday 03:00 — over.
    expect(isWithinWindow(wrap, new Date(Date.UTC(2026, 6, 22, 3)))).toBe(false);
  });

  it('matches only inside the window', () => {
    expect(isWithinWindow(window, new Date(Date.UTC(2026, 6, 21, 23, 30)))).toBe(true);
    expect(isWithinWindow(window, new Date(Date.UTC(2026, 6, 21, 22, 59)))).toBe(false);
    expect(isWithinWindow(window, new Date(Date.UTC(2026, 6, 22, 23, 30)))).toBe(false);
  });

  it('parses env specs and skips malformed ones', () => {
    expect(parseMaintenanceSpecs('steam:2:23-24:Weekly maintenance,vrchat:3:1-3')).toEqual([
      {
        services: ['steam'],
        name: 'Weekly maintenance',
        windows: [{ utcDay: 2, utcHourStart: 23, utcHourEnd: 24 }],
      },
      {
        services: ['vrchat'],
        name: 'Scheduled maintenance',
        windows: [{ utcDay: 3, utcHourStart: 1, utcHourEnd: 3 }],
      },
    ]);
    expect(parseMaintenanceSpecs('bogus,steam:9:1-2,:2:1-2,')).toEqual([]);
  });
});
