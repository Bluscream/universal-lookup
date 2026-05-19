import axios from 'axios';
import { config } from '../../config.js';
import type { LookupType, Provider, ProviderResult } from '../../types/common.js';

const PROVIDER_NAME = 'csfloat';

/**
 * csfloat — CS2 Database and skin market reputation indicator.
 * Queries CSFloat public API to see if the user is registered, and maps their trade metrics.
 */
export const csfloatProvider: Provider = {
  name: PROVIDER_NAME,

  isAvailable() {
    return true; // Publicly queryable without API key
  },

  async lookup(query: string, _type?: LookupType): Promise<ProviderResult> {
    const start = Date.now();

    try {
      const steamId = query.trim();
      const url = `https://csfloat.com/api/v1/users/${steamId}`;
      
      const res = await axios.get(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
        timeout: config.providerTimeout,
      });

      const userData = res.data?.user;
      if (!userData) {
        return {
          provider: PROVIDER_NAME,
          success: true, // Graceful return
          data: {
            csfloat_registered: false,
          },
          duration: Date.now() - start,
        };
      }

      return {
        provider: PROVIDER_NAME,
        success: true,
        data: {
          csfloat_registered: true,
          csfloat_username: userData.username,
          csfloat_avatar: userData.avatar,
          csfloat_total_sales: userData.statistics?.total_sales || 0,
          csfloat_total_purchases: userData.statistics?.total_purchases || 0,
          csfloat_median_delivery_seconds: userData.statistics?.median_delivery_time || null,
        },
        raw: res.data,
        duration: Date.now() - start,
      };
    } catch (error) {
      // CSFloat returns 500 "record not found" when the player is not registered in their DB.
      // We catch this gracefully as an unregistered state rather than a provider error.
      if (
        axios.isAxiosError(error) &&
        error.response &&
        (error.response.status === 404 || error.response.status === 500)
      ) {
        return {
          provider: PROVIDER_NAME,
          success: true,
          data: {
            csfloat_registered: false,
          },
          raw: error.response.data,
          duration: Date.now() - start,
        };
      }

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
