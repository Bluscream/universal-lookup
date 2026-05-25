import axios from 'axios';
import { config } from '../../config.js';
import { decrementRateLimit, isRateLimited, updateRateLimit } from '../../lib/rate-limiter.js';
import type { LookupType, Provider, ProviderResult } from '../../types/common.js';

const PROVIDER_NAME = 'ip-api.io/email';

export const ipApiIoEmail: Provider = {
  name: PROVIDER_NAME,
  isAvailable() {
    return !!config.ipApiIoKey;
  },

  async lookup(query: string, _type?: LookupType): Promise<ProviderResult> {
    const start = Date.now();
    try {
      const wait = isRateLimited(PROVIDER_NAME);
      if (wait > 0)
        return {
          provider: PROVIDER_NAME,
          success: false,
          data: {},
          error: `Rate limited, retry in ${wait}s`,
          duration: Date.now() - start,
        };

      const resp = await axios.get(
        `https://ip-api.io/api/v1/email/validate/${encodeURIComponent(query)}?api_key=${config.ipApiIoKey}`,
        {
          timeout: config.serverTimeout,
        },
      );
      decrementRateLimit(PROVIDER_NAME);
      updateRateLimit(PROVIDER_NAME, resp.headers as Record<string, string>);
      const raw = resp.data;

      return {
        provider: PROVIDER_NAME,
        success: true,
        data: {
          email: raw.email,
          disposable: raw.is_disposable,
          valid_syntax: raw.syntax?.is_valid,
          email_domain: raw.syntax?.domain,
          email_username: raw.syntax?.username,
          syntax_errors: raw.syntax?.error_reasons,
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
