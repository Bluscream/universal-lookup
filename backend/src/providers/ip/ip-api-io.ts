import axios from 'axios';
import { config } from '../../config.js';
import { decrementRateLimit, isRateLimited, updateRateLimit } from '../../lib/rate-limiter.js';
import type { IpData, LookupType, Provider, ProviderResult } from '../../types/common.js';

const PROVIDER_NAME = 'ip-api.io';

/**
 * ip-api.io — IP Geolocation & Security API.
 * Provides geolocation, VPN/proxy/Tor detection, and threat intelligence.
 *
 * Docs: https://ip-api.io/api-docs.html#tag/IP-Geolocation-and-Security-API
 */
export const ipApiIo: Provider = {
  name: PROVIDER_NAME,

  isAvailable() {
    return !!config.ipApiIoKey; // Requires API key
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

      const url = `https://ip-api.io/api/json?ip=${encodeURIComponent(query)}&api_key=${config.ipApiIoKey}`;

      const response = await axios.get(url, {
        timeout: config.serverTimeout,
      });

      decrementRateLimit(PROVIDER_NAME);
      updateRateLimit(PROVIDER_NAME, response.headers as Record<string, string>);

      const raw = response.data;

      // Map to normalized field names
      const data: IpData = {
        ip: raw.ip,
        country: raw.location?.country ?? raw.country,
        country_code: raw.location?.country_code ?? raw.country_code,
        city: raw.location?.city ?? raw.city,
        latitude: raw.location?.latitude ?? raw.latitude,
        longitude: raw.location?.longitude ?? raw.longitude,
        postal_code: raw.location?.zip ?? raw.zip,
        timezone: raw.location?.timezone ?? raw.timezone,
        local_time: raw.location?.local_time,
        is_daylight_savings: raw.location?.is_daylight_savings,
      };

      // Security/suspicious factors
      const sf = raw.suspicious_factors;
      if (sf) {
        data.proxy = sf.is_proxy;
        data.tor = sf.is_tor_node;
        data.vpn = sf.is_vpn;
        data.datacenter = sf.is_datacenter;
        data.crawler = sf.is_crawler;
        data.threat = sf.is_threat;
        data.spam = sf.is_spam;
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
