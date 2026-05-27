import axios from 'axios';
import { config } from '../../config.js';
import { normalizeLocation } from '../../lib/normalizer.js';
import type { LookupType, Provider, ProviderResult, LocationData } from '../../types/common.js';

const PROVIDER_NAME = 'google-maps';

export const googleMaps: Provider = {
  name: PROVIDER_NAME,
  isAvailable() {
    return !!config.googleApiKey;
  },

  async lookup(query: string, _type?: LookupType): Promise<ProviderResult<LocationData>> {
    const start = Date.now();
    try {
      const loc = normalizeLocation(query);
      let url: string;
      if (loc.isCoords && loc.lat !== undefined && loc.lon !== undefined) {
        url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${loc.lat},${loc.lon}&key=${config.googleApiKey}`;
      } else {
        url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(loc.query)}&key=${config.googleApiKey}`;
      }

      const resp = await axios.get(url, { timeout: config.serverTimeout });
      const raw = resp.data;

      if (raw.status !== 'OK' || !raw.results?.length) {
        return {
          provider: PROVIDER_NAME,
          success: false,
          data: {},
          raw,
          error: raw.status || 'No results',
          duration: Date.now() - start,
        };
      }

      const r = raw.results[0];
      const comps = r.address_components || [];
      const getComp = (type: string) =>
        comps.find((c: { types?: string[] }) => c.types?.includes(type));

      const data: LocationData = {
        formatted_address: r.formatted_address,
        latitude: r.geometry?.location?.lat,
        longitude: r.geometry?.location?.lng,
        place_id: r.place_id,
        location_type: r.geometry?.location_type,
        country: getComp('country')?.long_name,
        country_code: getComp('country')?.short_name,
        region: getComp('administrative_area_level_1')?.long_name,
        city: getComp('locality')?.long_name || getComp('administrative_area_level_2')?.long_name,
        district: getComp('sublocality')?.long_name,
        postal_code: getComp('postal_code')?.long_name,
        street: getComp('route')?.long_name,
        house_number: getComp('street_number')?.long_name,
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
