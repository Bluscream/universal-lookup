import { describe, expect, it, vi } from 'vitest';
import { mergeResponses } from '../backend/src/lib/merger.js';
import {
  normalizeIndicator,
  type StatuspageSummary,
  summaryToStatusData,
  clearIncidentCache,
} from '../backend/src/providers/status/statuspage.js';
import { xboxToSummary } from '../backend/src/providers/status/xbox.js';
import type { ProviderResult, StatusServiceEntry } from '../backend/src/types/common.js';

import { beforeEach } from 'vitest';

beforeEach(() => {
  clearIncidentCache();
  vi.useRealTimers();
});

describe('normalizeIndicator', () => {
  it('passes through canonical indicators', () => {
    for (const ind of ['none', 'minor', 'major', 'critical', 'maintenance'] as const) {
      expect(normalizeIndicator(ind)).toBe(ind);
    }
  });

  it('is case-insensitive and defaults unknown values', () => {
    expect(normalizeIndicator('MAJOR')).toBe('major');
    expect(normalizeIndicator('bogus')).toBe('unknown');
    expect(normalizeIndicator(undefined)).toBe('unknown');
  });
});

describe('summaryToStatusData (shared canonical mapper)', () => {
  it('maps an operational Statuspage summary', () => {
    const summary: StatuspageSummary = {
      page: {
        name: 'Discord',
        url: 'https://discordstatus.com',
        updated_at: '2026-07-04T00:00:00Z',
      },
      status: { indicator: 'none', description: 'All Systems Operational' },
      incidents: [],
    };
    const data = summaryToStatusData(summary, 'discord', 'Discord');
    const svc = data.services?.[0] as StatusServiceEntry;
    expect(svc.service).toBe('discord');
    expect(svc.name).toBe('Discord');
    expect(svc.indicator).toBe('none');
    expect(svc.operational).toBe(true);
    expect(svc.active_incidents).toBe(0);
    expect(svc.maintenance).toBe(false);
    expect(svc.maintainance).toBe(false);
    expect(svc.page_url).toBe('https://discordstatus.com');
    expect(data.incidents).toEqual([]);
  });

  it('includes a CDN icon URL for known services', () => {
    const summary: StatuspageSummary = { status: { indicator: 'none', description: 'ok' } };
    expect(summaryToStatusData(summary, 'steam', 'Steam').services?.[0].icon).toBe(
      'https://cdn.simpleicons.org/steam',
    );
    expect(summaryToStatusData(summary, 'nintendo', 'Nintendo').services?.[0].icon).toContain(
      'nintendo-switch',
    );
    expect(summaryToStatusData(summary, 'madeup', 'Made Up').services?.[0].icon).toBeNull();
  });

  it('tags each service with a category', () => {
    const summary: StatuspageSummary = { status: { indicator: 'none', description: 'ok' } };
    expect(summaryToStatusData(summary, 'aws', 'AWS').services?.[0].category).toBe('Cloud');
    expect(summaryToStatusData(summary, 'steam', 'Steam').services?.[0].category).toBe('Games');
    expect(summaryToStatusData(summary, 'playstation', 'PlayStation').services?.[0].category).toBe(
      'Games',
    );
    expect(summaryToStatusData(summary, 'madeup', 'X').services?.[0].category).toBe('Other');
  });

  it('respects explicitly passed category, brandColor, and icon parameters', () => {
    const summary: StatuspageSummary = { status: { indicator: 'none', description: 'ok' } };
    const data = summaryToStatusData(
      summary,
      'my-service',
      'My Service',
      undefined,
      false,
      undefined,
      'Custom Category',
      '#FF00FF',
      'custom-icon',
    );
    expect(data.services?.[0].category).toBe('Custom Category');
    expect(data.services?.[0].service_color).toBe('#FF00FF');
    expect(data.services?.[0].icon).toBe('https://cdn.simpleicons.org/custom-icon');
  });

  it('normalizes the status text for hand-rolled providers (verbatim=false)', () => {
    const oneIncident: StatuspageSummary = {
      status: { indicator: 'major', description: 'Issues affecting: Economy / Inventories' },
      incidents: [{ name: 'Inventory errors', status: 'identified', impact: 'major' }],
    };
    // A single active incident -> "Minor Service Outage" regardless of the
    // provider's own wordier description.
    expect(summaryToStatusData(oneIncident, 'cs2', 'Counter-Strike 2').services?.[0].status).toBe(
      'Minor Service Outage',
    );

    const many: StatuspageSummary = {
      status: { indicator: 'major', description: '3 active issues' },
      incidents: [
        { name: 'A', status: 'identified', impact: 'major' },
        { name: 'B', status: 'identified', impact: 'major' },
        { name: 'C', status: 'identified', impact: 'major' },
      ],
    };
    expect(summaryToStatusData(many, 'playstation', 'PSN').services?.[0].status).toBe(
      'Major Service Outage',
    );

    const maint: StatuspageSummary = { status: { indicator: 'maintenance', description: 'x' } };
    expect(summaryToStatusData(maint, 'psn', 'PSN').services?.[0].status).toBe('Under Maintenance');

    const ok: StatuspageSummary = {
      status: { indicator: 'none', description: 'All Systems Operational (240ms)' },
    };
    expect(summaryToStatusData(ok, 'battlenet', 'Battle.net').services?.[0].status).toBe(
      'All Systems Operational',
    );
  });

  it('keeps the upstream one-liner verbatim for native feeds (verbatim=true)', () => {
    const summary: StatuspageSummary = {
      status: { indicator: 'major', description: 'Partial System Outage' },
      incidents: [{ name: 'x', status: 'identified', impact: 'major' }],
    };
    expect(
      summaryToStatusData(summary, 'cloudflare', 'Cloudflare', undefined, true).services?.[0]
        .status,
    ).toBe('Partial System Outage');
  });

  it('surfaces active incidents but drops resolved ones', () => {
    const summary: StatuspageSummary = {
      page: { name: 'Cloudflare', url: 'https://www.cloudflarestatus.com' },
      status: { indicator: 'minor', description: 'Minor Service Outage' },
      incidents: [
        { name: 'Edge errors', status: 'monitoring', impact: 'minor', shortlink: 'https://x/1' },
        { name: 'Old thing', status: 'resolved', impact: 'major', shortlink: 'https://x/2' },
      ],
    };
    const data = summaryToStatusData(summary, 'cloudflare', 'Cloudflare');
    expect(data.services?.[0].operational).toBe(false);
    expect(data.services?.[0].active_incidents).toBe(1);
    expect(data.incidents).toHaveLength(1);
    expect(data.incidents?.[0]).toMatchObject({
      service: 'cloudflare',
      name: 'Edge errors',
      status: 'monitoring',
      url: 'https://x/1',
    });
  });

  it('deduplicates identical incidents with the exact same status and content', () => {
    const summary: StatuspageSummary = {
      page: { name: 'Nintendo', url: 'https://nintendo.com' },
      status: { indicator: 'maintenance', description: 'maintenance' },
      incidents: [
        {
          name: 'Online Play (Nintendo Switch games) (maintenance)',
          status: 'scheduled',
          impact: 'maintenance',
          shortlink: 'https://nintendo.com/info',
          started_at: 'Thursday,  9 July 2026  5:55',
          updated_at: 'Thursday,  9 July 2026  5:55',
        },
        {
          name: 'Online Play (Nintendo Switch games) (maintenance)',
          status: 'scheduled',
          impact: 'maintenance',
          shortlink: 'https://nintendo.com/info',
          started_at: 'Thursday,  9 July 2026  5:55',
          updated_at: 'Thursday,  9 July 2026  5:55',
        },
        {
          name: 'Online Play (Nintendo Switch games) (maintenance)',
          status: 'scheduled',
          impact: 'maintenance',
          shortlink: 'https://nintendo.com/info',
          started_at: 'Thursday,  9 July 2026  1:55',
          updated_at: 'Thursday,  9 July 2026  1:55',
        },
      ],
    };
    const data = summaryToStatusData(summary, 'nintendo', 'Nintendo');
    expect(data.services?.[0].active_incidents).toBe(2);
    expect(data.services?.[0].maintenance).toBe(true);
    expect(data.services?.[0].maintainance).toBe(true);
    expect(data.incidents).toHaveLength(2);
    expect(data.incidents?.[0].started_at).toBe('Thursday,  9 July 2026  5:55');
  });

  it('marks maintenance as true during scheduled weekly maintenance times', () => {
    // Steam: Tuesdays 22:00 UTC to Wednesdays 02:00 UTC
    // Tuesday is day 2. Let's set time to Tuesday 23:00 UTC.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-14T23:00:00Z')); // 2026-07-14 is Tuesday

    const summary: StatuspageSummary = {
      status: { indicator: 'none', description: 'All Systems Operational' },
    };

    const steamData = summaryToStatusData(summary, 'steam', 'Steam', undefined, false, [
      { utcDay: 2, utcHourStart: 22, utcHourEnd: 2 },
    ]);
    expect(steamData.services?.[0].maintenance).toBe(true);
    expect(steamData.services?.[0].maintainance).toBe(true);

    // Non-maintenance time: Monday 12:00 UTC
    vi.setSystemTime(new Date('2026-07-13T12:00:00Z')); // Monday
    const steamDataOk = summaryToStatusData(summary, 'steam', 'Steam', undefined, false, [
      { utcDay: 2, utcHourStart: 22, utcHourEnd: 2 },
    ]);
    expect(steamDataOk.services?.[0].maintenance).toBe(false);
    expect(steamDataOk.services?.[0].maintainance).toBe(false);

    // Blizzard: Tuesdays 14:00 to 18:00 UTC
    vi.setSystemTime(new Date('2026-07-14T15:00:00Z')); // Tuesday 15:00 UTC
    const blizzardData = summaryToStatusData(summary, 'blizzard', 'Battle.net', undefined, false, [
      { utcDay: 2, utcHourStart: 14, utcHourEnd: 18 },
    ]);
    expect(blizzardData.services?.[0].maintenance).toBe(true);
    expect(blizzardData.services?.[0].maintainance).toBe(true);

    vi.useRealTimers();
  });
});

describe('summaryToStatusData ignore list (STATUS_IGNORED)', () => {
  const summary = {
    page: { name: 'Activision', url: 'https://x' },
    status: { indicator: 'major', description: '3 active issues' },
    incidents: [
      { name: 'Crash Team Racing Nitro-Fueled — Xbox One', status: 'identified' },
      { name: 'Skylanders SuperChargers — Xbox 360', status: 'identified' },
      { name: 'Call of Duty: matchmaking down', status: 'identified' },
    ],
  };

  it('filters ignored incidents and keeps real ones', () => {
    const ignored = new Set([
      'crash team racing nitro-fueled — xbox one',
      'skylanders superchargers — xbox 360',
    ]);
    const data = summaryToStatusData(summary, 'activision', 'Activision', ignored);
    expect(data.incidents).toHaveLength(1);
    expect(data.incidents?.[0].name).toContain('Call of Duty');
    // Still one real incident -> stays non-operational.
    expect(data.services?.[0].operational).toBe(false);
    expect(data.services?.[0].active_incidents).toBe(1);
  });

  it('marks a service operational when ALL its incidents are ignored', () => {
    const ignored = new Set([
      'crash team racing nitro-fueled — xbox one',
      'skylanders superchargers — xbox 360',
      'call of duty', // substring match
    ]);
    const data = summaryToStatusData(summary, 'activision', 'Activision', ignored);
    expect(data.incidents).toEqual([]);
    expect(data.services?.[0].operational).toBe(true);
    expect(data.services?.[0].indicator).toBe('none');
    expect(data.services?.[0].status).toBe('All Systems Operational');
  });

  it('does nothing when the ignore set is empty', () => {
    const data = summaryToStatusData(summary, 'activision', 'Activision', new Set());
    expect(data.incidents).toHaveLength(3);
    expect(data.services?.[0].operational).toBe(false);
  });
});

describe('status providers merge into one unified response', () => {
  it('concatenates services and incidents across providers', () => {
    const discord = summaryToStatusData(
      { status: { indicator: 'none', description: 'ok' }, incidents: [] },
      'discord',
      'Discord',
    );
    const cloudflare = summaryToStatusData(
      {
        status: { indicator: 'minor', description: 'Minor Service Outage' },
        incidents: [{ name: 'Edge errors', status: 'monitoring', impact: 'minor' }],
      },
      'cloudflare',
      'Cloudflare',
    );
    const xbox = summaryToStatusData(
      xboxToSummary({ Status: { Overall: { State: 'None' } }, CoreServices: [] }),
      'xbox',
      'Xbox Live',
    );

    const results: ProviderResult[] = [
      { provider: 'discord', success: true, data: discord, duration: 10 },
      { provider: 'cloudflare', success: true, data: cloudflare, duration: 10 },
      { provider: 'xbox', success: true, data: xbox, duration: 10 },
    ];

    const merged = mergeResponses(results);
    const services = merged.services as StatusServiceEntry[];
    expect(services).toHaveLength(3);
    expect(services.map((s) => s.service).sort()).toEqual(['cloudflare', 'discord', 'xbox']);
    // Only Cloudflare contributed an incident.
    expect((merged.incidents as unknown[]).length).toBe(1);
  });
});
