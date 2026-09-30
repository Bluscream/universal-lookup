import axios from 'axios';
import { config } from '../../config.js';
import type {
  LocationData,
  LocationWarning,
  LookupType,
  Provider,
  ProviderResult,
} from '../../types/common.js';
import { geocode } from './geo.js';
import { capSeverity, tidyWarning, worstSeverity } from './warnings.js';

const PROVIDER_NAME = 'dwd';

/**
 * DWD severe-weather warnings, read through Bright Sky.
 *
 * DWD's own warning feed (dwd.de/DWD/warnungen/warnapp/json/warnings.json) is a
 * JSONP file covering all of Germany at once, keyed by internal warncell id with
 * no way to ask for one place — using it would mean shipping a warncell table and
 * matching region names by hand. Bright Sky is the DWD's data served over a plain
 * JSON API that takes coordinates and resolves the warncell itself, needs no key,
 * and reports which cell it picked, so the answer is checkable. It is the DWD's
 * own data either way, not a third-party forecast.
 */
const API_URL = 'https://api.brightsky.dev/alerts';

interface BrightSkyAlert {
  alert_id?: string;
  status?: string;
  effective?: string;
  onset?: string;
  expires?: string | null;
  category?: string | null;
  urgency?: string | null;
  severity?: string | null;
  event_en?: string | null;
  event_de?: string | null;
  headline_en?: string | null;
  headline_de?: string | null;
  description_en?: string | null;
  description_de?: string | null;
  instruction_en?: string | null;
  instruction_de?: string | null;
}

interface BrightSkyAlerts {
  alerts?: BrightSkyAlert[];
  location?: {
    warn_cell_id?: number;
    name?: string;
    district?: string;
    state?: string;
    state_short?: string;
  };
}

/** Prefer the configured language, fall back to the other rather than dropping it. */
function localized(
  alert: BrightSkyAlert,
  field: 'event' | 'headline' | 'description' | 'instruction',
): string | undefined {
  const german = config.locationWarningsGerman;
  const de = alert[`${field}_de`] ?? undefined;
  const en = alert[`${field}_en`] ?? undefined;
  return (german ? (de ?? en) : (en ?? de)) ?? undefined;
}

export function alertToWarning(alert: BrightSkyAlert, area?: string): LocationWarning {
  return tidyWarning({
    source: PROVIDER_NAME,
    event: localized(alert, 'event'),
    headline: localized(alert, 'headline'),
    description: localized(alert, 'description'),
    instruction: localized(alert, 'instruction'),
    severity: capSeverity(alert.severity),
    urgency: alert.urgency ?? undefined,
    area,
    start: alert.onset ?? alert.effective,
    end: alert.expires ?? undefined,
    url: 'https://www.dwd.de/DE/wetter/warnungen/warnWetter_node.html',
  });
}

export const dwdWarnings: Provider = {
  name: PROVIDER_NAME,

  isAvailable() {
    return config.locationWarningsEnabled;
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
      // DWD only warns for Germany. Saying so beats an empty result that reads
      // like "no warnings" for a place the service never covered.
      if (place.country_code && place.country_code !== 'de') {
        return {
          provider: PROVIDER_NAME,
          success: false,
          data: {},
          error: `DWD covers Germany only (resolved to ${place.country_code.toUpperCase()})`,
          duration: Date.now() - start,
        };
      }

      const resp = await axios.get<BrightSkyAlerts>(API_URL, {
        params: { lat: place.latitude, lon: place.longitude },
        timeout: config.serverTimeout,
      });

      const cell = resp.data?.location;
      const area = cell?.name ?? cell?.district;
      // "test" alerts are DWD's own exercises and would read as real ones.
      const alerts = (resp.data?.alerts ?? []).filter((a) => a.status !== 'test');
      const warnings = alerts.map((a) => alertToWarning(a, area));

      return {
        provider: PROVIDER_NAME,
        success: true,
        data: {
          warnings,
          warning_level: worstSeverity(warnings),
          // Which cell answered, so an unexpected result can be traced to the
          // resolution step rather than looking like bad warning data.
          dwd_warn_cell: cell?.name,
          dwd_warn_cell_id: cell?.warn_cell_id,
        },
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
