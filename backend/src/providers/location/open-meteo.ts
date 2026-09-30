import axios from 'axios';
import { config } from '../../config.js';
import type {
  LocationData,
  LocationWeather,
  LookupType,
  Provider,
  ProviderResult,
} from '../../types/common.js';
import { geocode } from './geo.js';

const PROVIDER_NAME = 'open-meteo';
const API_URL = 'https://api.open-meteo.com/v1/forecast';

/**
 * Current conditions from Open-Meteo.
 *
 * Chosen over the alternatives because it needs no API key at all — not even a
 * free-tier registration — and is worldwide, so it works for any place the
 * geocoder resolves rather than only for Germany like the DWD providers.
 */
const CURRENT_FIELDS = [
  'temperature_2m',
  'apparent_temperature',
  'relative_humidity_2m',
  'precipitation',
  'cloud_cover',
  'pressure_msl',
  'wind_speed_10m',
  'wind_gusts_10m',
  'wind_direction_10m',
  'weather_code',
].join(',');

interface OpenMeteoResponse {
  current?: {
    time?: string;
    temperature_2m?: number;
    apparent_temperature?: number;
    relative_humidity_2m?: number;
    precipitation?: number;
    cloud_cover?: number;
    pressure_msl?: number;
    wind_speed_10m?: number;
    wind_gusts_10m?: number;
    wind_direction_10m?: number;
    weather_code?: number;
  };
}

/**
 * WMO 4677 present-weather codes, which is what `weather_code` reports.
 * Grouped rather than exhaustive: the codes come in families (51/53/55 are
 * drizzle by intensity) and a reader wants the family.
 */
const WMO_CONDITIONS: Record<number, string> = {
  0: 'Clear sky',
  1: 'Mainly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Fog',
  48: 'Depositing rime fog',
  51: 'Light drizzle',
  53: 'Moderate drizzle',
  55: 'Dense drizzle',
  56: 'Light freezing drizzle',
  57: 'Dense freezing drizzle',
  61: 'Slight rain',
  63: 'Moderate rain',
  65: 'Heavy rain',
  66: 'Light freezing rain',
  67: 'Heavy freezing rain',
  71: 'Slight snowfall',
  73: 'Moderate snowfall',
  75: 'Heavy snowfall',
  77: 'Snow grains',
  80: 'Slight rain showers',
  81: 'Moderate rain showers',
  82: 'Violent rain showers',
  85: 'Slight snow showers',
  86: 'Heavy snow showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm with slight hail',
  99: 'Thunderstorm with heavy hail',
};

export function describeWeatherCode(code: number | undefined): string | undefined {
  return code === undefined ? undefined : WMO_CONDITIONS[code];
}

export const openMeteo: Provider = {
  name: PROVIDER_NAME,

  isAvailable() {
    return config.locationWeatherEnabled;
  },

  async lookup(query: string, _type?: LookupType): Promise<ProviderResult<LocationData>> {
    const start = Date.now();
    try {
      const place = await geocode(query);
      if (!place) {
        return {
          provider: PROVIDER_NAME,
          success: false,
          data: {},
          error: `Could not resolve "${query}" to coordinates`,
          duration: Date.now() - start,
        };
      }

      const resp = await axios.get<OpenMeteoResponse>(API_URL, {
        params: {
          latitude: place.latitude,
          longitude: place.longitude,
          current: CURRENT_FIELDS,
          timezone: 'auto',
        },
        timeout: config.serverTimeout,
      });

      const current = resp.data?.current;
      if (!current) {
        return {
          provider: PROVIDER_NAME,
          success: false,
          data: {},
          raw: resp.data,
          error: 'Open-Meteo returned no current conditions',
          duration: Date.now() - start,
        };
      }

      const weather: LocationWeather = {
        observed_at: current.time,
        temperature_c: current.temperature_2m,
        apparent_temperature_c: current.apparent_temperature,
        humidity_percent: current.relative_humidity_2m,
        precipitation_mm: current.precipitation,
        cloud_cover_percent: current.cloud_cover,
        pressure_hpa: current.pressure_msl,
        wind_speed_kmh: current.wind_speed_10m,
        wind_gust_kmh: current.wind_gusts_10m,
        wind_direction_deg: current.wind_direction_10m,
        condition: describeWeatherCode(current.weather_code),
        source: PROVIDER_NAME,
      };

      return {
        provider: PROVIDER_NAME,
        success: true,
        // Coordinates too: they cost nothing here and make a weather-only
        // response self-contained rather than only meaningful next to nominatim's.
        data: { latitude: place.latitude, longitude: place.longitude, weather },
        raw: resp.data,
        duration: Date.now() - start,
      };
    } catch (error) {
      return {
        provider: PROVIDER_NAME,
        success: false,
        data: {},
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - start,
      };
    }
  },
};
