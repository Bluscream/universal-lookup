import { describe, expect, it, vi } from 'vitest';
import { mergeResponses } from '../backend/src/lib/merger.js';
import { activisionToSummary } from '../backend/src/providers/status/activision.js';
import {
  realmsToSummary,
  reachabilityToSummary,
} from '../backend/src/providers/status/blizzard.js';
import { instatusToSummary } from '../backend/src/providers/status/instatus.js';
import { nintendoToSummary } from '../backend/src/providers/status/nintendo.js';
import { psnToSummary } from '../backend/src/providers/status/playstation.js';
import { ubisoftToSummary } from '../backend/src/providers/status/ubisoft.js';
import {
  normalizeIndicator,
  type StatuspageSummary,
  summaryToStatusData,
} from '../backend/src/providers/status/statuspage.js';
import { steamGroupSummary } from '../backend/src/providers/status/steam.js';
import { xboxToSummary } from '../backend/src/providers/status/xbox.js';
import type { ProviderResult, StatusServiceEntry } from '../backend/src/types/common.js';

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
      page: { name: 'Discord', url: 'https://discordstatus.com', updated_at: '2026-07-04T00:00:00Z' },
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
    expect(summaryToStatusData(summary, 'discord', 'Discord').services?.[0].icon).toBe(
      'https://cdn.simpleicons.org/discord',
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
    expect(summaryToStatusData(summary, 'github', 'GitHub').services?.[0].category).toBe('Web');
    expect(summaryToStatusData(summary, 'madeup', 'X').services?.[0].category).toBe('Other');
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
      ],
    };
    expect(summaryToStatusData(many, 'playstation', 'PSN').services?.[0].status).toBe(
      'Major Service Outage',
    );

    const maint: StatuspageSummary = { status: { indicator: 'maintenance', description: 'x' } };
    expect(summaryToStatusData(maint, 'psn', 'PSN').services?.[0].status).toBe('Under Maintenance');

    const ok: StatuspageSummary = { status: { indicator: 'none', description: 'All Systems Operational (240ms)' } };
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
      summaryToStatusData(summary, 'cloudflare', 'Cloudflare', undefined, true).services?.[0].status,
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
    
    const steamData = summaryToStatusData(summary, 'steam', 'Steam');
    expect(steamData.services?.[0].maintenance).toBe(true);
    expect(steamData.services?.[0].maintainance).toBe(true);

    // Non-maintenance time: Monday 12:00 UTC
    vi.setSystemTime(new Date('2026-07-13T12:00:00Z')); // Monday
    const steamDataOk = summaryToStatusData(summary, 'steam', 'Steam');
    expect(steamDataOk.services?.[0].maintenance).toBe(false);
    expect(steamDataOk.services?.[0].maintainance).toBe(false);

    // Blizzard: Tuesdays 14:00 to 18:00 UTC
    vi.setSystemTime(new Date('2026-07-14T15:00:00Z')); // Tuesday 15:00 UTC
    const blizzardData = summaryToStatusData(summary, 'blizzard', 'Battle.net');
    expect(blizzardData.services?.[0].maintenance).toBe(true);
    expect(blizzardData.services?.[0].maintainance).toBe(true);

    vi.useRealTimers();
  });
});

describe('xboxToSummary', () => {
  it('treats Overall state "None" as operational', () => {
    const summary = xboxToSummary({
      Status: { Overall: { State: 'None', LastUpdated: '2026-07-04T00:00:00Z' } },
      CoreServices: [{ Name: 'Account & profile', Status: { Name: 'None' } }],
    });
    expect(summary.status?.indicator).toBe('none');
    expect(summary.incidents).toEqual([]);
    const data = summaryToStatusData(summary, 'xbox', 'Xbox Live');
    expect(data.services?.[0].operational).toBe(true);
  });

  it('reports impacted categories as incidents', () => {
    const summary = xboxToSummary({
      Status: { Overall: { State: 'Impacted' } },
      CoreServices: [
        { Name: 'Account & profile', Status: { Name: 'None' } },
        { Name: 'Cloud gaming', Status: { Name: 'Impacted' } },
      ],
    });
    expect(summary.status?.indicator).toBe('major');
    expect(summary.incidents).toHaveLength(1);
    expect(summary.incidents?.[0].name).toContain('Cloud gaming');
  });
});

describe('psnToSummary', () => {
  it('is operational when all status arrays are empty', () => {
    const summary = psnToSummary(
      {
        regionName: 'SCEA',
        status: [],
        countries: [{ countryCode: 'US', status: [], services: [{ serviceName: 'PSN', status: [] }] }],
      },
      'US',
    );
    expect(summary.status?.indicator).toBe('none');
    expect(summary.incidents).toEqual([]);
  });

  it('flags only services with an active Outage entry', () => {
    const now = Date.parse('2026-07-05T00:00:00Z');
    const summary = psnToSummary(
      {
        regionName: 'SCEA',
        status: [],
        countries: [
          {
            countryCode: 'US',
            status: [],
            services: [
              { serviceName: 'Account Management', status: [] },
              {
                serviceName: 'PlayStation Store',
                status: [{ statusType: 'Outage', startDate: '2026-07-04T00:00:00Z' }],
              },
            ],
          },
        ],
      },
      'US',
      now,
    );
    expect(summary.status?.indicator).toBe('major');
    expect(summary.incidents).toHaveLength(1);
    expect(summary.incidents?.[0].name).toContain('PlayStation Store');
  });

  it('target country stays operational for another country outage, but still lists it', () => {
    const now = Date.parse('2026-07-05T00:00:00Z');
    const outage = { statusType: 'Outage', startDate: '2026-07-04T00:00:00Z' };
    const summary = psnToSummary(
      {
        regionName: 'SCEE',
        status: [outage], // region-level aggregate includes another country's outage
        countries: [
          { countryCode: 'DE', status: [], services: [{ serviceName: 'Store', status: [] }] },
          { countryCode: 'RU', status: [outage], services: [{ serviceName: 'Store', status: [outage] }] },
        ],
      },
      'DE',
      now,
    );
    // DE itself is operational...
    expect(summary.status?.indicator).toBe('none');
    // ...but the RU outage is still surfaced as an incident, labelled with RU.
    expect(summary.incidents).toHaveLength(1);
    expect(summary.incidents?.[0].name).toContain('RU');
    expect(summary.status?.description).toContain('elsewhere');
  });

  it('global mode ("all"): any active outage anywhere marks PSN affected', () => {
    const now = Date.parse('2026-07-05T00:00:00Z');
    const outage = { statusType: 'Outage', startDate: '2026-07-04T00:00:00Z' };
    const summary = psnToSummary(
      {
        regionName: 'SCEE',
        status: [outage],
        countries: [
          { countryCode: 'DE', status: [], services: [{ serviceName: 'Store', status: [] }] },
          { countryCode: 'RU', status: [outage], services: [{ serviceName: 'Store', status: [outage] }] },
        ],
      },
      'all',
      now,
    );
    // No country filter -> the RU outage drives the overall status.
    expect(summary.status?.indicator).toBe('major');
    expect(summary.status?.description).not.toContain('elsewhere');
    expect(summary.incidents).toHaveLength(1);
    expect(summary.incidents?.[0].name).toContain('RU');
  });

  it('does NOT flag resolved (past endDate) or scheduled (future startDate) entries', () => {
    const now = Date.parse('2026-07-05T00:00:00Z');
    const summary = psnToSummary(
      {
        regionName: 'SCEA',
        status: [],
        countries: [
          {
            countryCode: 'US',
            status: [],
            services: [
              // Resolved outage (ended yesterday) — the feed still lists it.
              {
                serviceName: 'Account Management',
                status: [
                  { statusType: 'Outage', startDate: '2026-07-01T00:00:00Z', endDate: '2026-07-02T00:00:00Z' },
                ],
              },
              // Scheduled maintenance next week.
              {
                serviceName: 'PlayStation Store',
                status: [{ statusType: 'Maintenance', startDate: '2026-07-12T00:00:00Z' }],
              },
            ],
          },
        ],
      },
      'US',
      now,
    );
    expect(summary.status?.indicator).toBe('none');
    expect(summary.incidents).toEqual([]);
  });

  it('reports active maintenance as a maintenance indicator, not major', () => {
    const now = Date.parse('2026-07-05T00:00:00Z');
    const summary = psnToSummary(
      {
        regionName: 'SCEA',
        status: [],
        countries: [
          {
            countryCode: 'US',
            status: [],
            services: [
              {
                serviceName: 'PlayStation Video',
                status: [{ statusType: 'Maintenance', startDate: '2026-07-04T23:00:00Z' }],
              },
            ],
          },
        ],
      },
      'US',
      now,
    );
    expect(summary.status?.indicator).toBe('maintenance');
    expect(summary.incidents?.[0].impact).toBe('maintenance');
  });
});

describe('activisionToSummary', () => {
  it('is operational with an empty serverStatuses array', () => {
    const summary = activisionToSummary({ updatedTime: 1783178106, serverStatuses: [] });
    expect(summary.status?.indicator).toBe('none');
    expect(summary.incidents).toEqual([]);
  });

  it('maps each active server status to an incident', () => {
    const summary = activisionToSummary({
      serverStatuses: [
        { gameTitle: 'Call of Duty', platform: 'PC', status: 'degraded' },
        { gameTitle: 'Warzone', platform: 'PlayStation 5' },
      ],
    });
    expect(summary.status?.indicator).toBe('major');
    expect(summary.status?.description).toContain('2 active');
    expect(summary.incidents).toHaveLength(2);
    expect(summary.incidents?.[0].name).toContain('Call of Duty');
  });
});

describe('steamGroupSummary (Steam / CS2 split)', () => {
  const STEAM = { SessionsLogon: 'Sessions & Login', SteamCommunity: 'Community' };
  const CS2 = { IEconItems: 'Economy / Inventories', Leaderboards: 'Leaderboards' };

  it('Steam group is operational when login + community are normal', () => {
    const s = steamGroupSummary(
      { SessionsLogon: 'normal', SteamCommunity: 'normal', IEconItems: 'offline' },
      STEAM,
      'Steam',
    );
    expect(s.status?.indicator).toBe('none');
    expect(s.incidents).toEqual([]);
  });

  it('CS2 group reflects its own services (econ offline = major, no contradiction)', () => {
    const services = { SessionsLogon: 'normal', SteamCommunity: 'normal', IEconItems: 'offline' };
    const cs2 = steamGroupSummary(services, CS2, 'Counter-Strike 2');
    expect(cs2.status?.indicator).toBe('major');
    expect(cs2.incidents).toHaveLength(1);
    expect(cs2.incidents?.[0].name).toContain('Economy');
  });

  it('Steam group is down when a core service is offline', () => {
    const s = steamGroupSummary({ SessionsLogon: 'offline', SteamCommunity: 'normal' }, STEAM, 'Steam');
    expect(s.status?.indicator).toBe('major');
  });

  it('treats "idle" as operational', () => {
    const s = steamGroupSummary({ SessionsLogon: 'idle', SteamCommunity: 'idle' }, STEAM, 'Steam');
    expect(s.status?.indicator).toBe('none');
    expect(s.incidents).toEqual([]);
  });
});

describe('instatusToSummary (EA)', () => {
  it('maps page status UP to operational', () => {
    const summary = instatusToSummary(
      { page: { name: 'EA', url: 'https://ea.instatus.com', status: 'UP' } },
      'EA',
      'https://ea.instatus.com',
    );
    expect(summary.status?.indicator).toBe('none');
    expect(summary.incidents).toEqual([]);
  });

  it('derives the indicator from the worst active incident', () => {
    const summary = instatusToSummary(
      {
        page: { status: 'HASISSUES' },
        activeIncidents: [
          { name: 'Login delays', impact: 'MINOROUTAGE', status: 'MONITORING' },
          { name: 'Matchmaking down', impact: 'MAJOROUTAGE', status: 'IDENTIFIED' },
        ],
      },
      'EA',
      'https://ea.instatus.com',
    );
    expect(summary.status?.indicator).toBe('major');
    expect(summary.incidents).toHaveLength(2);
  });

  it('treats UNDERMAINTENANCE as maintenance', () => {
    const summary = instatusToSummary(
      { page: { status: 'UNDERMAINTENANCE' }, activeMaintenances: [{ name: 'Scheduled' }] },
      'EA',
      'https://ea.instatus.com',
    );
    expect(summary.status?.indicator).toBe('maintenance');
    expect(summary.incidents).toHaveLength(1);
  });
});

describe('ubisoftToSummary', () => {
  it('is operational when all apps are online', () => {
    const summary = ubisoftToSummary({
      lastModifiedAt: '2026-07-04T00:00:00Z',
      gameStatuses: [
        { name: 'R6 - PC', status: 'online', isMaintenance: false, impactedFeatures: [] },
        { name: 'R6 - PS5', status: 'online', isMaintenance: false, impactedFeatures: [] },
      ],
    });
    expect(summary.status?.indicator).toBe('none');
    expect(summary.incidents).toEqual([]);
  });

  it('flags maintenance, impacted features, and offline apps', () => {
    const summary = ubisoftToSummary({
      gameStatuses: [
        { name: 'A - PC', status: 'online', isMaintenance: false, impactedFeatures: [] },
        { name: 'B - PC', status: 'online', isMaintenance: true, impactedFeatures: [] },
        { name: 'C - PC', status: 'online', isMaintenance: false, impactedFeatures: ['Matchmaking'] },
        { name: 'D - PC', status: 'interrupted', isMaintenance: false, impactedFeatures: [] },
      ],
    });
    // Worst is the interrupted app -> major.
    expect(summary.status?.indicator).toBe('major');
    // 3 non-operational apps become incidents (maintenance, impacted, interrupted).
    expect(summary.incidents).toHaveLength(3);
    expect(summary.incidents?.map((i) => i.name.split(':')[0])).toEqual(['B - PC', 'C - PC', 'D - PC']);
  });
});

describe('blizzard realmsToSummary (detailed mode)', () => {
  it('is operational when all sampled realms are up with no queue', () => {
    const summary = realmsToSummary(
      [
        { name: 'Tichondrius', up: true, hasQueue: false },
        { name: 'Area 52', up: true, hasQueue: false },
      ],
      'us',
    );
    expect(summary.status?.indicator).toBe('none');
    expect(summary.incidents).toEqual([]);
  });

  it('flags a down realm as major and a queued realm as minor', () => {
    const down = realmsToSummary([{ name: 'Illidan', up: false, hasQueue: false }], 'us');
    expect(down.status?.indicator).toBe('major');
    expect(down.incidents?.[0].name).toContain('Down');

    const queued = realmsToSummary([{ name: 'Illidan', up: true, hasQueue: true }], 'us');
    expect(queued.status?.indicator).toBe('minor');
    expect(queued.incidents?.[0].name).toContain('queue');
  });
});

describe('blizzard reachabilityToSummary (approximate mode)', () => {
  it('reachable + fast = operational', () => {
    expect(reachabilityToSummary(true, 120, 2500).status?.indicator).toBe('none');
  });
  it('reachable + slow = minor', () => {
    expect(reachabilityToSummary(true, 4000, 2500).status?.indicator).toBe('minor');
  });
  it('unreachable = major', () => {
    expect(reachabilityToSummary(false, 0, 2500).status?.indicator).toBe('major');
  });
});

describe('nintendoToSummary', () => {
  it('is operational when both arrays are empty', () => {
    const summary = nintendoToSummary({ operational_statuses: [], temporary_maintenances: [] });
    expect(summary.status?.indicator).toBe('none');
    expect(summary.incidents).toEqual([]);
  });

  it('maps outages to major incidents and maintenance to maintenance', () => {
    const summary = nintendoToSummary({
      operational_statuses: [{ software_title: 'Splatoon 3', platform: ['Nintendo Switch'] }],
      temporary_maintenances: [{ services: 'eShop', platform: ['Nintendo Switch 2'] }],
    });
    expect(summary.status?.indicator).toBe('major'); // an outage outranks maintenance
    expect(summary.incidents).toHaveLength(2);
    expect(summary.incidents?.[0].name).toBe('Splatoon 3');
    expect(summary.incidents?.[1].impact).toBe('maintenance');
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
