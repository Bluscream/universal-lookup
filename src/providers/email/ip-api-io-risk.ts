import axios from 'axios';
import { config } from '../../config.js';
import type { Provider, ProviderResult } from '../../types/common.js';
import { updateRateLimit, isRateLimited, decrementRateLimit } from '../../lib/rate-limiter.js';

const PROVIDER_NAME = 'ip-api.io/email-risk';

export const ipApiIoEmailRisk: Provider = {
  name: PROVIDER_NAME,
  isAvailable() { return !!config.ipApiIoKey; },

  async lookup(query: string): Promise<ProviderResult> {
    const start = Date.now();
    try {
      const wait = isRateLimited(PROVIDER_NAME);
      if (wait > 0) return { provider: PROVIDER_NAME, success: false, data: {}, error: `Rate limited`, duration: Date.now() - start };

      const resp = await axios.get(`https://ip-api.io/api/v1/risk/email/${encodeURIComponent(query)}?api_key=${config.ipApiIoKey}`, {
        timeout: config.providerTimeout,
      });
      decrementRateLimit(PROVIDER_NAME);
      updateRateLimit(PROVIDER_NAME, resp.headers as Record<string, string>);
      const raw = resp.data;

      return {
        provider: PROVIDER_NAME, success: true,
        data: {
          risk_score: raw.score,
          risk_level: raw.risk_level,
          email_risk_disposable: raw.factors?.email_factors?.is_disposable,
          email_risk_valid_syntax: raw.factors?.email_factors?.is_valid_syntax,
        },
        raw, duration: Date.now() - start,
      };
    } catch (error) {
      return { provider: PROVIDER_NAME, success: false, data: {}, error: error instanceof Error ? error.message : String(error), duration: Date.now() - start };
    }
  },
};
