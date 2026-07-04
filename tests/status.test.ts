import { describe, expect, it } from 'vitest';
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
import { steamToSummary } from '../backend/src/providers/status/steam.js';
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
    expect(summary.incidents?.[0].name).toBe('PlayStation Store');
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

describe('steamToSummary', () => {
  it('is operational when core services are normal', () => {
    const summary = steamToSummary({
      result: { services: { SessionsLogon: 'normal', SteamCommunity: 'normal' } },
    });
    expect(summary.status?.indicator).toBe('none');
    const data = summaryToStatusData(summary, 'steam', 'Steam');
    expect(data.services?.[0].operational).toBe(true);
  });

  it('marks Steam down when a core service is offline', () => {
    const summary = steamToSummary({
      result: { services: { SessionsLogon: 'offline', SteamCommunity: 'normal' } },
    });
    expect(summary.status?.indicator).toBe('major');
  });

  it('does NOT mark Steam down for a degraded non-core (CS econ) service', () => {
    const summary = steamToSummary({
      result: {
        services: { SessionsLogon: 'normal', SteamCommunity: 'normal', IEconItems: 'offline' },
      },
    });
    // Overall stays operational...
    expect(summary.status?.indicator).toBe('none');
    // ...but the degraded econ service is still surfaced as an incident.
    expect(summary.incidents).toHaveLength(1);
    expect(summary.incidents?.[0].name).toContain('Economy');
  });

  it('treats "idle" as operational', () => {
    const summary = steamToSummary({
      result: { services: { SessionsLogon: 'idle', SteamCommunity: 'idle' } },
    });
    expect(summary.status?.indicator).toBe('none');
    expect(summary.incidents).toEqual([]);
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
