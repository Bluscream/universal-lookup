import axios from 'axios';
import { config } from '../../config.js';
import type { Provider, ProviderResult } from '../../types/common.js';
import { normalizeLocation } from '../../lib/normalizer.js';

const PROVIDER_NAME = 'google-maps';

export const googleMaps: Provider = {
  name: PROVIDER_NAME,
  isAvailable() { return !!config.googleMapsApiKey; },

  async lookup(query: string): Promise<ProviderResult> {
    const start = Date.now();
    try {
      const loc = normalizeLocation(query);
      let url: string;
      if (loc.isCoords && loc.lat !== undefined && loc.lon !== undefined) {
        url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${loc.lat},${loc.lon}&key=${config.googleMapsApiKey}`;
      } else {
        url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(loc.query)}&key=${config.googleMapsApiKey}`;
      }

      const resp = await axios.get(url, { timeout: config.providerTimeout });
      const raw = resp.data;

      if (raw.status !== 'OK' || !raw.results?.length) {
        return { provider: PROVIDER_NAME, success: false, data: {}, raw, error: raw.status || 'No results', duration: Date.now() - start };
      }

      const r = raw.results[0];
      const comps = r.address_components || [];
      const getComp = (type: string) => comps.find((c: any) => c.types?.includes(type));

      const data: Record<string, unknown> = {
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
      return { provider: PROVIDER_NAME, success: false, data: {}, error: error instanceof Error ? error.message : String(error), duration: Date.now() - start };
    }
  },
};
