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

const PROVIDER_NAME = 'nina';
const BASE_URL = 'https://warnung.bund.de/api31';

/**
 * Civil-protection warnings from NINA, the BBK's official warning app.
 *
 * This is the feed behind the app: MOWAS (police, fire and disaster control),
 * plus flood and civil-defence channels. In practice it carries exactly the
 * utility-outage and drinking-water events one would otherwise scrape from an
 * outage site — "Versorgungsunterbrechung Gas", "Abkochgebot für Trinkwasser" —
 * from the authority that issued them.
 *
 * Two paths, because the precise one is not always available:
 *  - with a regional key, `dashboard/<ARS>.json` is NINA's own per-district feed
 *    and does the geographic matching server-side, so the answer is exact;
 *  - without one, the national MOWAS list is filtered by the state code embedded
 *    in each warning id (mow.DE-HE-WI-… is Hessen). That is state-wide, so it
 *    over-reports, and `nina_match` says which path produced the answer.
 */
const ISO_TO_ARS_PREFIX: Record<string, string> = {
  BW: '08',
  BY: '09',
  BE: '11',
  BB: '12',
  HB: '04',
  HH: '02',
  HE: '06',
  MV: '13',
  NI: '03',
  NW: '05',
  RP: '07',
  SL: '10',
  SN: '14',
  ST: '15',
  SH: '01',
  TH: '16',
};

interface NinaPayloadData {
  headline?: string;
  provider?: string;
  severity?: string;
  urgency?: string;
  msgType?: string;
  transKeys?: { event?: string };
  area?: Array<{ areaDesc?: string }>;
}

interface NinaDashboardItem {
  id?: string;
  startDate?: string;
  expiresDate?: string;
  payload?: { id?: string; data?: NinaPayloadData };
  i18nTitle?: Record<string, string>;
  severity?: string;
  urgency?: string;
  type?: string;
}

interface NinaDetail {
  sent?: string;
  info?: Array<{
    event?: string;
    category?: string[];
    urgency?: string;
    severity?: string;
    headline?: string;
    description?: string;
    instruction?: string;
    web?: string;
    area?: Array<{ areaDesc?: string }>;
  }>;
}

/**
 * Reduce a regional key to the district level NINA's dashboard is keyed by.
 *
 * OSM tags the key at whatever level the boundary sits, so a town yields a
 * municipality key (Annaburg: 150910010010) and NINA answers that with a 404,
 * not an empty list. The first five digits are state + district — 15091 is
 * Wittenberg — and zero-padding those gives the key the dashboard accepts
 * (150910000000), which does return Annaburg's warning. A kreisfreie Stadt like
 * Wiesbaden is already district level and passes through unchanged.
 */
export function districtArs(ars: string): string {
  return ars.slice(0, 5).padEnd(12, '0');
}

/** Warning ids look like `mow.DE-HE-WI-W097-20260926-000`. */
export function stateFromWarningId(id: string | undefined): string | undefined {
  const match = /^[a-z]+\.DE-([A-Z]{2})-/.exec(id ?? '');
  return match?.[1];
}

/** `https://warnung.bund.de/meldung/<id>` is the public page for a warning. */
function warningUrl(id: string | undefined): string | undefined {
  return id ? `https://warnung.bund.de/meldung/${id}` : undefined;
}

function title(item: NinaDashboardItem): string | undefined {
  const i18n = item.i18nTitle ?? {};
  const preferred = config.locationWarningsGerman ? i18n.de : i18n.en;
  return preferred ?? i18n.de ?? i18n.en ?? item.payload?.data?.headline;
}

/** Build a warning from a list entry, enriched with detail when we fetched it. */
export function ninaToWarning(item: NinaDashboardItem, detail?: NinaDetail): LocationWarning {
  const id = item.id ?? item.payload?.id;
  const info = detail?.info?.[0];
  const data = item.payload?.data;
  return tidyWarning({
    source: PROVIDER_NAME,
    event: info?.event ?? data?.transKeys?.event,
    headline: info?.headline ?? title(item),
    description: info?.description,
    instruction: info?.instruction,
    severity: capSeverity(info?.severity ?? item.severity ?? data?.severity),
    urgency: info?.urgency ?? item.urgency ?? data?.urgency,
    area: info?.area?.[0]?.areaDesc ?? data?.area?.[0]?.areaDesc,
    start: item.startDate,
    end: item.expiresDate,
    url: info?.web ?? warningUrl(id),
  });
}

async function get<T>(path: string): Promise<T> {
  const resp = await axios.get<T>(`${BASE_URL}${path}`, {
    timeout: config.serverTimeout,
    headers: { Accept: 'application/json' },
  });
  return resp.data;
}

/**
 * Fetch the CAP detail for each warning, for the description and instruction the
 * list omits. Capped by LOCATION_NINA_DETAIL_LIMIT: an alert that matters is at
 * the top, and a nationwide event could otherwise mean dozens of extra requests
 * inside one lookup's timeout. A detail fetch that fails is not fatal — the list
 * entry already carries the headline and severity.
 */
async function withDetails(items: NinaDashboardItem[]): Promise<LocationWarning[]> {
  const limit = Math.max(0, config.locationNinaDetailLimit);
  return Promise.all(
    items.map(async (item, index) => {
      const id = item.id ?? item.payload?.id;
      if (!id || index >= limit) return ninaToWarning(item);
      try {
        return ninaToWarning(item, await get<NinaDetail>(`/warnings/${id}.json`));
      } catch {
        return ninaToWarning(item);
      }
    }),
  );
}

export const ninaWarnings: Provider = {
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
          error: `Could not resolve "${query}" to a place`,
          duration: Date.now() - start,
        };
      }
      if (place.country_code && place.country_code !== 'de') {
        return {
          provider: PROVIDER_NAME,
          success: false,
          data: {},
          error: `NINA covers Germany only (resolved to ${place.country_code.toUpperCase()})`,
          duration: Date.now() - start,
        };
      }

      let items: NinaDashboardItem[] | undefined;
      let match = '';
      let raw: unknown;

      if (place.ars) {
        const ars = districtArs(place.ars);
        try {
          items = await get<NinaDashboardItem[]>(`/dashboard/${ars}.json`);
          match = `district (ARS ${ars})`;
          raw = items;
        } catch {
          // A key NINA does not recognise must not end the lookup: without this
          // the precise path could return less than the state-wide one it was
          // meant to improve on, which is how Annaburg's outage went missing.
          items = undefined;
        }
      }

      if (items === undefined) {
        const national = await get<NinaDashboardItem[]>('/mowas/mapData.json');
        const prefix = place.state_code ? ISO_TO_ARS_PREFIX[place.state_code] : undefined;
        items = place.state_code
          ? national.filter((i) => stateFromWarningId(i.id) === place.state_code)
          : national;
        match = place.state_code ? `state (${place.state_code})` : 'nationwide';
        raw = { filtered_from: national.length, ars_prefix: prefix, items };
      }

      const warnings = await withDetails(items);

      return {
        provider: PROVIDER_NAME,
        success: true,
        data: {
          warnings,
          warning_level: worstSeverity(warnings),
          // How precisely the warnings were matched to the query. Without this a
          // state-wide answer is indistinguishable from an exact one.
          nina_match: match,
        },
        raw,
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
