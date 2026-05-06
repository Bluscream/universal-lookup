import axios from 'axios';
import { config } from '../../config.js';
import type { Provider, ProviderResult } from '../../types/common.js';
import { updateRateLimit, isRateLimited, decrementRateLimit } from '../../lib/rate-limiter.js';

const PROVIDER_NAME = 'ip-api.io/risk';

/**
 * ip-api.io Risk Score API — fraud detection for IP addresses.
 * Returns a risk score 0.0-1.0 with factor breakdown.
 *
 * Docs: https://ip-api.io/api-docs.html#tag/Risk-Score-API
 */
export const ipApiIoRisk: Provider = {
  name: PROVIDER_NAME,

  isAvailable() {
    return !!config.ipApiIoKey;
  },

  async lookup(query: string): Promise<ProviderResult> {
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

      const url = `https://ip-api.io/api/v1/risk/ip/${encodeURIComponent(query)}?api_key=${config.ipApiIoKey}`;

      const response = await axios.get(url, {
        timeout: config.providerTimeout,
      });

      decrementRateLimit(PROVIDER_NAME);
      updateRateLimit(PROVIDER_NAME, response.headers as Record<string, string>);

      const raw = response.data;

      const data: Record<string, unknown> = {
        risk_score: raw.score,
        risk_level: raw.risk_level,
      };

      // Add IP-specific risk factors
      if (raw.factors?.ip_factors) {
        const ipf = raw.factors.ip_factors;
        data.risk_proxy = ipf.is_proxy;
        data.risk_tor = ipf.is_tor_node;
        data.risk_spam = ipf.is_spam;
        data.risk_vpn = ipf.is_vpn;
        data.risk_datacenter = ipf.is_datacenter;
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
