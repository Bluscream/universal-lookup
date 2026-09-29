import { describe, expect, it, vi } from 'vitest';
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
  summaryToStatusData,
  clearIncidentCache,
} from '../backend/src/providers/status/statuspage.js';
import { steamGroupSummary } from '../backend/src/providers/status/steam.js';
import { xboxToSummary } from '../backend/src/providers/status/xbox.js';

import { beforeEach } from 'vitest';

beforeEach(() => {
  clearIncidentCache();
  vi.useRealTimers();
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
        countries: [
          { countryCode: 'US', status: [], services: [{ serviceName: 'PSN', status: [] }] },
        ],
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
          {
            countryCode: 'RU',
            status: [outage],
            services: [{ serviceName: 'Store', status: [outage] }],
          },
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
          {
            countryCode: 'RU',
            status: [outage],
            services: [{ serviceName: 'Store', status: [outage] }],
          },
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
                  {
                    statusType: 'Outage',
                    startDate: '2026-07-01T00:00:00Z',
                    endDate: '2026-07-02T00:00:00Z',
                  },
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
    const s = steamGroupSummary(
      { SessionsLogon: 'offline', SteamCommunity: 'normal' },
      STEAM,
      'Steam',
    );
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
        {
          name: 'C - PC',
          status: 'online',
          isMaintenance: false,
          impactedFeatures: ['Matchmaking'],
        },
        { name: 'D - PC', status: 'interrupted', isMaintenance: false, impactedFeatures: [] },
      ],
    });
    // Worst is the interrupted app -> major.
    expect(summary.status?.indicator).toBe('major');
    // 3 non-operational apps become incidents (maintenance, impacted, interrupted).
    expect(summary.incidents).toHaveLength(3);
    expect(summary.incidents?.map((i) => i.name.split(':')[0])).toEqual([
      'B - PC',
      'C - PC',
      'D - PC',
    ]);
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
