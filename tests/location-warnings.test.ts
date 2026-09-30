import axios from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../backend/src/config.js';
import { dwdWarnings } from '../backend/src/providers/location/dwd.js';
import { clearGeoCache, geocode } from '../backend/src/providers/location/geo.js';
import { districtArs, ninaWarnings } from '../backend/src/providers/location/nina.js';
import { openMeteo } from '../backend/src/providers/location/open-meteo.js';
import { capSeverity, worstSeverity } from '../backend/src/providers/location/warnings.js';
import type { LocationData, LocationWarning } from '../backend/src/types/common.js';

// Every upstream here is a public service with a usage policy (Nominatim asks for
// 1 req/s), so nothing in the suite touches the network.
vi.mock('axios');

const mockedAxios = vi.mocked(axios, true);

/** Route a GET by URL fragment, so a test states the whole conversation at once. */
function routeGet(handlers: Record<string, unknown>) {
  mockedAxios.get.mockImplementation(async (url: string) => {
    for (const [fragment, data] of Object.entries(handlers)) {
      if (url.includes(fragment)) {
        if (data instanceof Error) throw data;
        return { data, status: 200 } as never;
      }
    }
    throw new Error(`unexpected GET ${url}`);
  });
}

/** A Nominatim hit for Wiesbaden, whose boundary carries the regional key. */
const WIESBADEN = {
  lat: '50.0820384',
  lon: '8.2416556',
  display_name: 'Wiesbaden, Hessen, Deutschland',
  address: {
    city: 'Wiesbaden',
    state: 'Hessen',
    postcode: '65183',
    country_code: 'de',
    'ISO3166-2-lvl4': 'DE-HE',
  },
  extratags: { 'de:regionalschluessel': '064140000000' },
};

/** The same place reached by postcode: no boundary, so no regional key. */
const PLZ_HIT = { ...WIESBADEN, extratags: null };

beforeEach(() => {
  vi.clearAllMocks();
  clearGeoCache();
  config.locationWarningsEnabled = true;
  config.locationWeatherEnabled = true;
  config.locationWarningsGerman = true;
  config.locationNinaDetailLimit = 5;
});

describe('capSeverity', () => {
  it('folds the CAP vocabulary onto the canonical scale', () => {
    expect(capSeverity('Extreme')).toBe('extreme');
    expect(capSeverity('severe')).toBe('severe');
    expect(capSeverity('Minor')).toBe('minor');
  });

  it('reports unknown rather than guessing at an unrecognised value', () => {
    expect(capSeverity('Catastrophic')).toBe('unknown');
    expect(capSeverity(undefined)).toBe('unknown');
  });
});

describe('worstSeverity', () => {
  it('picks the most severe entry, not the first', () => {
    const warnings = [
      { source: 'a', severity: 'minor' },
      { source: 'b', severity: 'extreme' },
      { source: 'c', severity: 'moderate' },
    ] as LocationWarning[];
    expect(worstSeverity(warnings)).toBe('extreme');
  });

  it('is undefined for no warnings, so the field is omitted rather than "none"', () => {
    expect(worstSeverity([])).toBeUndefined();
  });
});

describe('geocode', () => {
  it('reads the regional key straight off the boundary when the query names one', async () => {
    routeGet({ '/search': [WIESBADEN] });
    const place = await geocode('Wiesbaden');
    expect(place?.ars).toBe('064140000000');
    expect(place?.state_code).toBe('HE');
    expect(place?.country_code).toBe('de');
    // One request: no second search is needed when the key is already there.
    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
  });

  it('recovers the regional key by name when the query resolved to a postcode', async () => {
    let call = 0;
    mockedAxios.get.mockImplementation(async () => {
      call += 1;
      return { data: [call === 1 ? PLZ_HIT : WIESBADEN], status: 200 } as never;
    });
    const place = await geocode('65183');
    expect(place?.ars).toBe('064140000000');
    expect(call).toBe(2);
  });

  it('caches, so every provider in one fan-out shares a single upstream request', async () => {
    routeGet({ '/search': [WIESBADEN] });
    await Promise.all([geocode('Wiesbaden'), geocode('Wiesbaden'), geocode('Wiesbaden')]);
    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
  });

  it('reverse-geocodes a coordinate query', async () => {
    routeGet({ '/reverse': WIESBADEN });
    const place = await geocode('50.0820384, 8.2416556');
    expect(place?.latitude).toBeCloseTo(50.082, 2);
    expect(mockedAxios.get.mock.calls[0]?.[0]).toContain('/reverse');
  });

  it('returns null when nothing resolves, rather than throwing into the provider', async () => {
    routeGet({ '/search': [] });
    expect(await geocode('asdfqwerzxcv')).toBeNull();
  });
});

describe('districtArs', () => {
  it('reduces a municipality key to the district key NINA answers to', () => {
    // Annaburg's boundary key 404s; Wittenberg's district key returns its warning.
    expect(districtArs('150910010010')).toBe('150910000000');
    expect(districtArs('082155003029')).toBe('082150000000');
  });

  it('leaves a kreisfreie Stadt, already at district level, alone', () => {
    expect(districtArs('064140000000')).toBe('064140000000');
  });
});

describe('nina', () => {
  const BOIL_NOTICE = {
    id: 'mow.DE-HE-WI-W097-20260926-000',
    startDate: '2026-09-26T12:00:00+02:00',
    severity: 'Minor',
    i18nTitle: { de: 'Abkochgebot für Trinkwasser', en: 'Boil water notice' },
  };
  const DETAIL = {
    info: [
      {
        event: 'Gefahreninformation',
        severity: 'Minor',
        urgency: 'Immediate',
        headline: 'Vorsorgliches Abkochgebot für Trinkwasser',
        description: 'Das Wasser muss abgekocht werden.',
        instruction: 'Wasser vor Gebrauch abkochen.',
        web: 'https://www.wiesbaden.de/krisenfall',
        area: [{ areaDesc: 'Wiesbaden-Mitte' }],
      },
    ],
  };

  it('uses the district feed when a regional key is available', async () => {
    routeGet({ '/search': [WIESBADEN], '/dashboard/': [BOIL_NOTICE], '/warnings/': DETAIL });
    const res = await ninaWarnings.lookup('Wiesbaden');
    const data = res.data as LocationData;
    expect(res.success).toBe(true);
    expect(data.nina_match).toBe('district (ARS 064140000000)');
    expect(data.warnings).toHaveLength(1);
    expect(data.warning_level).toBe('minor');
  });

  it('enriches a warning with the detail the list omits', async () => {
    routeGet({ '/search': [WIESBADEN], '/dashboard/': [BOIL_NOTICE], '/warnings/': DETAIL });
    const res = await ninaWarnings.lookup('Wiesbaden');
    const warning = (res.data as LocationData).warnings?.[0];
    expect(warning?.instruction).toBe('Wasser vor Gebrauch abkochen.');
    expect(warning?.event).toBe('Gefahreninformation');
    expect(warning?.area).toBe('Wiesbaden-Mitte');
    expect(warning?.source).toBe('nina');
  });

  it('still reports a warning whose detail fetch failed', async () => {
    routeGet({
      '/search': [WIESBADEN],
      '/dashboard/': [BOIL_NOTICE],
      '/warnings/': new Error('502 Bad Gateway'),
    });
    const warning = ((await ninaWarnings.lookup('Wiesbaden')).data as LocationData).warnings?.[0];
    expect(warning?.headline).toBe('Abkochgebot für Trinkwasser');
    expect(warning?.severity).toBe('minor');
  });

  it('falls back to the national list when the district key is rejected', async () => {
    // The regression this guards: an unrecognised key used to end the lookup, so
    // the precise path returned less than the state-wide one it improves on.
    routeGet({
      '/search': [WIESBADEN],
      '/dashboard/': new Error('404 Not Found'),
      '/mowas/mapData.json': [BOIL_NOTICE, { ...BOIL_NOTICE, id: 'mow.DE-BY-BA-W140-1' }],
      '/warnings/': DETAIL,
    });
    const data = (await ninaWarnings.lookup('Wiesbaden')).data as LocationData;
    expect(data.nina_match).toBe('state (HE)');
    // Only the Hessen warning: DE-BY- is Bavaria.
    expect(data.warnings).toHaveLength(1);
  });

  it('keeps only its own state when filtering the national list', async () => {
    routeGet({
      '/search': [{ ...PLZ_HIT, address: { ...PLZ_HIT.address, city: undefined } }],
      '/mowas/mapData.json': [
        { ...BOIL_NOTICE, id: 'mow.DE-TH-G-W109-1' },
        { ...BOIL_NOTICE, id: 'mow.DE-HE-WI-W097-1' },
        { ...BOIL_NOTICE, id: 'mow.DE-BW-KA-W138-1' },
      ],
      '/warnings/': DETAIL,
    });
    const data = (await ninaWarnings.lookup('65183')).data as LocationData;
    expect(data.nina_match).toBe('state (HE)');
    expect(data.warnings).toHaveLength(1);
  });

  it('fetches detail for no more warnings than the configured limit', async () => {
    config.locationNinaDetailLimit = 2;
    const many = Array.from({ length: 6 }, (_, i) => ({
      ...BOIL_NOTICE,
      id: `mow.DE-HE-WI-W${i}-0`,
    }));
    routeGet({ '/search': [WIESBADEN], '/dashboard/': many, '/warnings/': DETAIL });
    const data = (await ninaWarnings.lookup('Wiesbaden')).data as LocationData;
    expect(data.warnings).toHaveLength(6);
    const details = mockedAxios.get.mock.calls.filter((c) => String(c[0]).includes('/warnings/'));
    expect(details).toHaveLength(2);
  });

  it('says it does not cover a place outside Germany instead of reporting no warnings', async () => {
    routeGet({
      '/search': [
        { lat: '48.85', lon: '2.35', address: { country_code: 'fr', 'ISO3166-2-lvl4': 'FR-IDF' } },
      ],
    });
    const res = await ninaWarnings.lookup('Paris');
    expect(res.success).toBe(false);
    expect(res.error).toContain('Germany only');
    expect(res.data.warnings).toBeUndefined();
  });

  it('is skipped entirely when warnings are disabled', () => {
    config.locationWarningsEnabled = false;
    expect(ninaWarnings.isAvailable()).toBe(false);
    expect(dwdWarnings.isAvailable()).toBe(false);
  });
});

describe('dwd', () => {
  const GUST_ALERT = {
    alert_id: '2.49.0.0.276.0.DWD.PVW.1',
    status: 'actual',
    onset: '2026-09-30T08:00:00+00:00',
    expires: '2026-09-30T19:00:00+00:00',
    severity: 'severe',
    urgency: 'immediate',
    event_en: 'wind gusts',
    event_de: 'Sturmböen',
    headline_en: 'Official WARNING of WIND GUSTS',
    headline_de: 'Amtliche WARNUNG vor STURMBÖEN',
  };
  const CELL = { warn_cell_id: 706414102, name: 'Wiesbaden-Süd', district: 'Wiesbaden' };

  it('maps an alert onto the shared warning shape', async () => {
    routeGet({
      '/search': [WIESBADEN],
      'brightsky.dev/alerts': { alerts: [GUST_ALERT], location: CELL },
    });
    const data = (await dwdWarnings.lookup('Wiesbaden')).data as LocationData;
    const warning = data.warnings?.[0];
    expect(warning?.severity).toBe('severe');
    expect(warning?.source).toBe('dwd');
    expect(warning?.area).toBe('Wiesbaden-Süd');
    expect(warning?.start).toBe('2026-09-30T08:00:00+00:00');
    expect(data.warning_level).toBe('severe');
    expect(data.dwd_warn_cell_id).toBe(706414102);
  });

  it('honours the language preference and falls back rather than dropping text', async () => {
    routeGet({
      '/search': [WIESBADEN],
      'brightsky.dev/alerts': { alerts: [GUST_ALERT], location: CELL },
    });
    expect((await dwdWarnings.lookup('Wiesbaden')).data.warnings?.[0]?.event).toBe('Sturmböen');

    clearGeoCache();
    config.locationWarningsGerman = false;
    expect((await dwdWarnings.lookup('Wiesbaden')).data.warnings?.[0]?.event).toBe('wind gusts');

    clearGeoCache();
    routeGet({
      '/search': [WIESBADEN],
      'brightsky.dev/alerts': {
        alerts: [{ ...GUST_ALERT, event_en: null }],
        location: CELL,
      },
    });
    // English was asked for and is missing: the German is better than nothing.
    expect((await dwdWarnings.lookup('Wiesbaden')).data.warnings?.[0]?.event).toBe('Sturmböen');
  });

  it('ignores DWD test alerts, which would otherwise read as real ones', async () => {
    routeGet({
      '/search': [WIESBADEN],
      'brightsky.dev/alerts': {
        alerts: [{ ...GUST_ALERT, status: 'test' }],
        location: CELL,
      },
    });
    const data = (await dwdWarnings.lookup('Wiesbaden')).data as LocationData;
    expect(data.warnings).toEqual([]);
    expect(data.warning_level).toBeUndefined();
  });

  it('succeeds with an empty list when there is nothing to warn about', async () => {
    routeGet({ '/search': [WIESBADEN], 'brightsky.dev/alerts': { alerts: [], location: CELL } });
    const res = await dwdWarnings.lookup('Wiesbaden');
    expect(res.success).toBe(true);
    expect(res.data.warnings).toEqual([]);
  });
});

describe('open-meteo', () => {
  const CURRENT = {
    current: {
      time: '2026-09-30T02:30',
      temperature_2m: 17.4,
      apparent_temperature: 16.7,
      relative_humidity_2m: 58,
      precipitation: 0,
      cloud_cover: 51,
      pressure_msl: 1020.2,
      wind_speed_10m: 3.2,
      wind_gusts_10m: 9.4,
      wind_direction_10m: 333,
      weather_code: 2,
    },
  };

  it('maps current conditions onto the canonical weather fields', async () => {
    routeGet({ '/search': [WIESBADEN], 'open-meteo.com': CURRENT });
    const data = (await openMeteo.lookup('Wiesbaden')).data as LocationData;
    expect(data.weather).toMatchObject({
      temperature_c: 17.4,
      apparent_temperature_c: 16.7,
      humidity_percent: 58,
      wind_gust_kmh: 9.4,
      condition: 'Partly cloudy',
      source: 'open-meteo',
    });
    // Coordinates make a weather-only answer readable on its own.
    expect(data.latitude).toBeCloseTo(50.082, 2);
  });

  it('leaves the condition unset for a code it does not know, rather than inventing one', async () => {
    routeGet({
      '/search': [WIESBADEN],
      'open-meteo.com': { current: { ...CURRENT.current, weather_code: 4 } },
    });
    const data = (await openMeteo.lookup('Wiesbaden')).data as LocationData;
    expect(data.weather?.condition).toBeUndefined();
    expect(data.weather?.temperature_c).toBe(17.4);
  });

  it('works anywhere, unlike the German-only warning providers', async () => {
    routeGet({
      '/search': [{ lat: '48.85', lon: '2.35', address: { country_code: 'fr' } }],
      'open-meteo.com': CURRENT,
    });
    expect((await openMeteo.lookup('Paris')).success).toBe(true);
  });

  it('reports a query it could not place, instead of silently returning nothing', async () => {
    routeGet({ '/search': [] });
    const res = await openMeteo.lookup('asdfqwerzxcv');
    expect(res.success).toBe(false);
    expect(res.error).toContain('coordinates');
  });
});
