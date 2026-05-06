import axios from 'axios';
import { config } from '../../config.js';
import { normalizeLocation } from '../../lib/normalizer.js';
import type { Provider, ProviderResult } from '../../types/common.js';

const PROVIDER_NAME = 'nominatim';

export const nominatim: Provider = {
  name: PROVIDER_NAME,
  isAvailable() {
    return true;
  },

  async lookup(query: string): Promise<ProviderResult> {
    const start = Date.now();
    try {
      const loc = normalizeLocation(query);
      let url: string;
      if (loc.isCoords && loc.lat !== undefined && loc.lon !== undefined) {
        url = `https://nominatim.openstreetmap.org/reverse?lat=${loc.lat}&lon=${loc.lon}&format=json&addressdetails=1`;
      } else {
        url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(loc.query)}&format=json&addressdetails=1&limit=1`;
      }

      const resp = await axios.get(url, {
        timeout: config.providerTimeout,
        headers: {
          'User-Agent': 'universal-lookup/1.0 (https://github.com/Bluscream/universal-lookup)',
        },
      });

      const raw = resp.data;
      const result = Array.isArray(raw) ? raw[0] : raw;
      if (!result) {
        return {
          provider: PROVIDER_NAME,
          success: false,
          data: {},
          raw,
          error: 'No results found',
          duration: Date.now() - start,
        };
      }

      const addr = result.address || {};
      const data: Record<string, unknown> = {
        display_name: result.display_name,
        latitude: parseFloat(result.lat),
        longitude: parseFloat(result.lon),
        osm_type: result.osm_type,
        osm_id: result.osm_id,
        place_type: result.type,
        place_class: result.class,
        country: addr.country,
        country_code: addr.country_code?.toUpperCase(),
        region: addr.state,
        city: addr.city || addr.town || addr.village || addr.municipality,
        district: addr.suburb || addr.city_district,
        street: addr.road,
        house_number: addr.house_number,
        postal_code: addr.postcode,
        neighbourhood: addr.neighbourhood,
      };

      return { provider: PROVIDER_NAME, success: true, data, raw, duration: Date.now() - start };
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
