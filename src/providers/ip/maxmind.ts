import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../../config.js';
import type { Provider, ProviderResult } from '../../types/common.js';

const PROVIDER_NAME = 'maxmind';

// biome-ignore lint/suspicious/noExplicitAny: MaxMind reader types are complex and lazy-loaded
let cityReader: any = null;
// biome-ignore lint/suspicious/noExplicitAny: MaxMind reader types are complex and lazy-loaded
let asnReader: any = null;
// biome-ignore lint/suspicious/noExplicitAny: MaxMind reader types are complex and lazy-loaded
let countryReader: any = null;
let initialized = false;

/**
 * MaxMind GeoLite2 — Local geolocation database.
 * Requires .mmdb files in MAXMIND_DB_PATH directory.
 * Zero network latency, very fast lookups.
 *
 * Databases: GeoLite2-City, GeoLite2-ASN, GeoLite2-Country
 */
export const maxmind: Provider = {
  name: PROVIDER_NAME,

  isAvailable() {
    const dbPath = config.maxmindDbPath;
    return (
      existsSync(join(dbPath, 'GeoLite2-City.mmdb')) ||
      existsSync(join(dbPath, 'GeoLite2-Country.mmdb')) ||
      existsSync(join(dbPath, 'GeoLite2-ASN.mmdb'))
    );
  },

  async lookup(query: string): Promise<ProviderResult> {
    const start = Date.now();

    try {
      if (!initialized) {
        await initReaders();
        initialized = true;
      }

      const data: Record<string, unknown> = {};
      const raw: Record<string, unknown> = {};

      // City database
      if (cityReader) {
        try {
          const city = cityReader.city(query);
          raw.city = city;
          data.country = city.country?.names?.en;
          data.country_code = city.country?.isoCode;
          data.region = city.subdivisions?.[0]?.names?.en;
          data.region_code = city.subdivisions?.[0]?.isoCode;
          data.city = city.city?.names?.en;
          data.postal_code = city.postal?.code;
          data.latitude = city.location?.latitude;
          data.longitude = city.location?.longitude;
          data.accuracy_radius = city.location?.accuracyRadius;
          data.timezone = city.location?.timeZone;
          data.continent = city.continent?.names?.en;
          data.continent_code = city.continent?.code;
        } catch (_e) {
          // IP not found in city DB — not an error
        }
      }

      // ASN database
      if (asnReader) {
        try {
          const asn = asnReader.asn(query);
          raw.asn = asn;
          data.asn = asn.autonomousSystemNumber ? `AS${asn.autonomousSystemNumber}` : undefined;
          data.asn_org = asn.autonomousSystemOrganization;
          data.network = asn.network;
        } catch (_e) {
          // IP not found in ASN DB
        }
      }

      // Country database (fallback for country data)
      if (countryReader && !data.country) {
        try {
          const country = countryReader.country(query);
          raw.country = country;
          data.country = country.country?.names?.en;
          data.country_code = country.country?.isoCode;
          data.continent = country.continent?.names?.en;
          data.continent_code = country.continent?.code;
        } catch (_e) {
          // IP not found in country DB
        }
      }

      const hasData = Object.values(data).some((v) => v !== undefined);
      if (!hasData) {
        return {
          provider: PROVIDER_NAME,
          success: false,
          data: {},
          error: 'IP not found in MaxMind databases',
          duration: Date.now() - start,
        };
      }

      return {
        provider: PROVIDER_NAME,
        success: true,
        data,
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

async function initReaders() {
  const { Reader } = await import('@maxmind/geoip2-node');
  const dbPath = config.maxmindDbPath;

  const cityPath = join(dbPath, 'GeoLite2-City.mmdb');
  const asnPath = join(dbPath, 'GeoLite2-ASN.mmdb');
  const countryPath = join(dbPath, 'GeoLite2-Country.mmdb');

  if (existsSync(cityPath)) {
    cityReader = await Reader.open(cityPath);
  }
  if (existsSync(asnPath)) {
    asnReader = await Reader.open(asnPath);
  }
  if (existsSync(countryPath)) {
    countryReader = await Reader.open(countryPath);
  }
}
