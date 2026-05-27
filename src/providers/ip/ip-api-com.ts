import axios from 'axios';
import { config } from '../../config.js';
import { decrementRateLimit, isRateLimited, updateRateLimit } from '../../lib/rate-limiter.js';
import type { LookupType, Provider, ProviderResult, IpData } from '../../types/common.js';

const PROVIDER_NAME = 'ip-api.com';

/**
 * ip-api.com — Free IP geolocation API.
 * Free tier: 45 req/min, HTTP only.
 * Pro: HTTPS + unlimited with API key.
 *
 * Docs: https://ip-api.com/docs/api:json
 */
export const ipApiCom: Provider = {
  name: PROVIDER_NAME,

  isAvailable() {
    return true; // Always available (free tier)
  },

  async lookup(query: string, _type?: LookupType): Promise<ProviderResult<IpData>> {
    const start = Date.now();

    try {
      const waitTime = isRateLimited(PROVIDER_NAME);
      if (waitTime > 0) {
        return {
          provider: PROVIDER_NAME,
          success: false,
          data: {},
          error: `Rate limited, retry in ${waitTime}s`,
          duration: Date.now() - start,
        };
      }

      const protocol = config.ipApiComKey ? 'https' : 'http';
      const keyParam = config.ipApiComKey ? `&key=${config.ipApiComKey}` : '';
      const fields =
        'status,message,continent,continentCode,country,countryCode,region,regionName,city,district,zip,lat,lon,timezone,offset,currency,isp,org,as,asname,reverse,mobile,proxy,hosting,query';

      const url = `${protocol}://ip-api.com/json/${encodeURIComponent(query)}?fields=${fields}${keyParam}`;
      const response = await axios.get(url, { timeout: config.serverTimeout });

      decrementRateLimit(PROVIDER_NAME);
      updateRateLimit(PROVIDER_NAME, response.headers as Record<string, string>);

      const raw = response.data;

      if (raw.status === 'fail') {
        return {
          provider: PROVIDER_NAME,
          success: false,
          data: {},
          raw,
          error: raw.message || 'Unknown error',
          duration: Date.now() - start,
        };
      }

      // Map to normalized field names
      const data: IpData = {
        ip: raw.query,
        continent: raw.continent,
        continent_code: raw.continentCode,
        country: raw.country,
        country_code: raw.countryCode,
        region: raw.regionName,
        region_code: raw.region,
        city: raw.city,
        district: raw.district,
        postal_code: raw.zip,
        latitude: raw.lat,
        longitude: raw.lon,
        timezone: raw.timezone,
        utc_offset: raw.offset,
        currency: raw.currency,
        isp: raw.isp,
        org: raw.org,
        as: raw.as,
        asn_org: raw.asname,
        reverse_dns: raw.reverse,
        mobile: raw.mobile,
        proxy: raw.proxy,
        hosting: raw.hosting,
      };

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
