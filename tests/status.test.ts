import { describe, expect, it } from 'vitest';
import { mergeResponses } from '../backend/src/lib/merger.js';
import { activisionToSummary } from '../backend/src/providers/status/activision.js';
import { psnToSummary } from '../backend/src/providers/status/playstation.js';
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

  it('flags impacted services in the target country', () => {
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
              { serviceName: 'Gaming And Social', status: [{ note: 'down' }] },
            ],
          },
        ],
      },
      'US',
    );
    expect(summary.status?.indicator).toBe('major');
    expect(summary.incidents).toHaveLength(1);
    expect(summary.incidents?.[0].name).toBe('Gaming And Social');
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
