import axios from 'axios';
import { config } from '../../config.js';
import type { LookupType, ParcelData, Provider, ProviderResult } from '../../types/common.js';

const PROVIDER_NAME = 'amazon-tba';

export const amazonTba: Provider = {
  name: PROVIDER_NAME,
  isAvailable() {
    return true; // Publicly accessible Amazon tracking endpoint
  },

  async lookup(query: string, _type?: LookupType): Promise<ProviderResult<ParcelData>> {
    const start = Date.now();
    
    // Check for Amazon Logistics tracking number formats (typically TBA, TBC, TBM, TQA)
    const upperQuery = query.toUpperCase();
    const isAmazonLogistics = /^(TBA|TBC|TBM|TQA)\d+/.test(upperQuery);
    
    if (!isAmazonLogistics) {
      return {
        provider: PROVIDER_NAME,
        success: false,
        data: {},
        error: 'Not a standard Amazon Logistics tracking number',
        duration: Date.now() - start,
      };
    }

    try {
      const url = `https://track.amazon.com/api/tracker/${encodeURIComponent(query)}`;
      const response = await axios.get(url, {
        timeout: config.serverTimeout,
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        }
      });

      const raw = response.data;
      if (!raw || (!raw.eventHistory && !raw.status)) {
        return {
          provider: PROVIDER_NAME,
          success: false,
          data: {},
          error: 'No tracking details found in Amazon response',
          raw,
          duration: Date.now() - start,
        };
      }

      const eventHistory = raw.eventHistory || [];
      const events = eventHistory.map((e: any) => {
        return {
          date: e.eventTime ? new Date(e.eventTime).toISOString() : new Date().toISOString(),
          status: e.status || 'Status Update',
          description: e.status || undefined,
          location: e.location || undefined,
          source: 'Amazon',
        };
      });

      // Sort events oldest to newest
      events.sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime());

      const statusText = raw.status || (events[events.length - 1]?.status) || 'In Transit';
      const isDelivered = statusText.toLowerCase().includes('delivered') || raw.progressPercent === 100;

      const data: ParcelData = {
        tracking_number: query,
        couriers: ['Amazon'],
        status: statusText,
        status_description: statusText,
        delivered: isDelivered,
        events,
      };

      return {
        provider: PROVIDER_NAME,
        success: true,
        data,
        raw,
        duration: Date.now() - start,
      };
    } catch (error: any) {
      // 404 is common if the tracking number is not found
      if (error.response?.status === 404) {
        return {
          provider: PROVIDER_NAME,
          success: false,
          data: {},
          error: 'Amazon Logistics tracking number not found',
          duration: Date.now() - start,
        };
      }
      return {
        provider: PROVIDER_NAME,
        success: false,
        data: {},
        error: error.message || String(error),
        duration: Date.now() - start,
      };
    }
  },
};
