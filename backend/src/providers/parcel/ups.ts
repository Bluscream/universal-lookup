import axios from 'axios';
import { config } from '../../config.js';
import type { LookupType, ParcelData, Provider, ProviderResult } from '../../types/common.js';

const PROVIDER_NAME = 'ups';

interface UpsActivity {
  status?: { description?: string; code?: string };
  location?: {
    address?: {
      city?: string;
      stateProvince?: string;
      postalCode?: string;
      countryCode?: string;
    };
  };
  date?: string;
  time?: string;
}

function parseUpsDateTime(dateStr: string, timeStr: string): string {
  if (!dateStr) return new Date().toISOString();
  try {
    const year = dateStr.substring(0, 4);
    const month = dateStr.substring(4, 6);
    const day = dateStr.substring(6, 8);
    const hour = timeStr ? timeStr.substring(0, 2) : '00';
    const min = timeStr ? timeStr.substring(2, 4) : '00';
    const sec = timeStr ? timeStr.substring(4, 6) : '00';
    return new Date(`${year}-${month}-${day}T${hour}:${min}:${sec}`).toISOString();
  } catch {
    return new Date().toISOString();
  }
}

export const ups: Provider = {
  name: PROVIDER_NAME,
  isAvailable() {
    return !!config.upsAccessKey;
  },

  async lookup(query: string, _type?: LookupType): Promise<ProviderResult<ParcelData>> {
    const start = Date.now();
    try {
      const accessKey = config.upsAccessKey;
      if (!accessKey) {
        throw new Error('Missing UPS Access License Number');
      }

      const url = `https://onlinetools.ups.com/track/v1/details/${encodeURIComponent(query)}`;

      const response = await axios.get(url, {
        timeout: config.serverTimeout,
        headers: {
          AccessLicenseNumber: accessKey,
          Accept: 'application/json',
        },
      });

      const raw = response.data;
      const shipment = raw?.trackResponse?.shipment?.[0];
      const packageInfo = shipment?.package?.[0];

      if (!shipment || !packageInfo) {
        return {
          provider: PROVIDER_NAME,
          success: false,
          data: {},
          error: 'No shipment or package information found in UPS response',
          raw,
          duration: Date.now() - start,
        };
      }

      const rawActivities: UpsActivity[] = packageInfo.activity || [];
      const events = rawActivities.map((act) => {
        const statusText = act.status?.description || act.status?.code || 'Unknown Event';
        const address = act.location?.address;
        const locationParts = [
          address?.city,
          address?.stateProvince,
          address?.postalCode,
          address?.countryCode,
        ].filter(Boolean);

        return {
          date: parseUpsDateTime(act.date ?? '', act.time ?? ''),
          status: statusText,
          description: statusText,
          location: locationParts.join(', ') || undefined,
          source: PROVIDER_NAME,
        };
      });

      // Sort events oldest to newest
      events.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

      const latestActivity: UpsActivity = rawActivities[0] || {};
      const statusText = latestActivity.status?.description || 'In Transit';
      const statusCode = latestActivity.status?.code;
      const isDelivered = statusCode === 'D' || statusText.toLowerCase().includes('delivered');

      const data: ParcelData = {
        tracking_number: query,
        couriers: ['UPS'],
        status: statusText,
        status_code: statusCode,
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
    } catch (error) {
      const apiMessage = axios.isAxiosError(error)
        ? error.response?.data?.trackResponse?.errors?.[0]?.message
        : undefined;
      return {
        provider: PROVIDER_NAME,
        success: false,
        data: {},
        error:
          apiMessage ||
          (error instanceof Error ? error.message : String(error)),
        duration: Date.now() - start,
      };
    }
  },
};
