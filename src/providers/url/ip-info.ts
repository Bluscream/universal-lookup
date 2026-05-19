import { mergeResponses } from '../../lib/merger.js';
import type { LookupType, Provider, ProviderResult } from '../../types/common.js';
import { lookupIp } from '../ip/index.js';

const PROVIDER_NAME = 'ip-info';

/**
 * ip-info — Takes resolved IP addresses and performs a detailed IP lookup.
 */
export const ipInfoProvider: Provider = {
  name: PROVIDER_NAME,

  isAvailable() {
    return true; // Always available
  },

  async lookup(query: string, _type?: LookupType): Promise<ProviderResult> {
    const start = Date.now();

    // The query is expected to be a resolved IP address.
    // If it's not a valid IP, we return an error (it will be called with a resolved IP in the main orchestrator).
    const isIpAddress = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(query) || query.includes(':');
    if (!isIpAddress) {
      return {
        provider: PROVIDER_NAME,
        success: false,
        data: {},
        error: 'IP Info lookup requires a fully resolved IP address',
        duration: Date.now() - start,
      };
    }

    try {
      // Run the existing IP lookup pipeline
      const ipResults = await lookupIp(query, 'ip');
      const merged = mergeResponses(ipResults);
      const success = ipResults.some((r) => r.success);

      return {
        provider: PROVIDER_NAME,
        success,
        data: {
          ip: query,
          ...merged,
        },
        raw: ipResults,
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
