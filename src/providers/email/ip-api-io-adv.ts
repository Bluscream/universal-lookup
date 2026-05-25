import axios from 'axios';
import { config } from '../../config.js';
import { decrementRateLimit, isRateLimited, updateRateLimit } from '../../lib/rate-limiter.js';
import type { LookupType, Provider, ProviderResult } from '../../types/common.js';

const PROVIDER_NAME = 'ip-api.io/email-advanced';

export const ipApiIoAdvEmail: Provider = {
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
          error: `Rate limited`,
          duration: Date.now() - start,
        };

      const resp = await axios.get(
        `https://ip-api.io/api/v1/email/validate/advanced/${encodeURIComponent(query)}?api_key=${config.ipApiIoKey}`,
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
          reachable: raw.reachable,
          smtp_host_exists: raw.smtp?.host_exists,
          smtp_deliverable: raw.smtp?.deliverable,
          smtp_full_inbox: raw.smtp?.full_inbox,
          smtp_catch_all: raw.smtp?.catch_all,
          smtp_disabled: raw.smtp?.disabled,
          has_gravatar: raw.gravatar?.has_gravatar,
          gravatar_url: raw.gravatar?.gravatar_url || undefined,
          suggestion: raw.suggestion || undefined,
          disposable: raw.disposable,
          role_account: raw.role_account,
          free_provider: raw.free,
          mx_records: raw.has_mx_records,
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
