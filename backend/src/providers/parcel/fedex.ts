import axios from 'axios';
import { config } from '../../config.js';
import type { LookupType, ParcelData, Provider, ProviderResult } from '../../types/common.js';

const PROVIDER_NAME = 'fedex';

export const fedex: Provider = {
  name: PROVIDER_NAME,
  isAvailable() {
    return !!config.fedexApiKey && !!config.fedexSecretKey;
  },

  async lookup(query: string, _type?: LookupType): Promise<ProviderResult<ParcelData>> {
    const start = Date.now();
    try {
      const apiKey = config.fedexApiKey;
      const apiSecret = config.fedexSecretKey;
      const apiUrl = 'https://apis.fedex.com';

      if (!apiKey || !apiSecret) {
        throw new Error('Missing FedEx API Key or Secret');
      }

      // Step 1: Retrieve OAuth access token
      const authParams = new URLSearchParams();
      authParams.append('grant_type', 'client_credentials');
      authParams.append('client_id', apiKey);
      authParams.append('client_secret', apiSecret);

      const authResp = await axios.post(`${apiUrl}/oauth/token`, authParams, {
        timeout: config.serverTimeout,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      });

      const accessToken = authResp.data?.access_token;
      if (!accessToken) {
        throw new Error('Failed to retrieve FedEx access token');
      }

      // Step 2: Track Package
      const trackUrl = `${apiUrl}/track/v1/trackingnumbers`;
      const trackPayload = {
        trackingInfo: [
          {
            trackingNumberInfo: {
              trackingNumber: query,
            },
          },
        ],
        includeDetailedScans: true,
      };

      const trackResp = await axios.post(trackUrl, trackPayload, {
        timeout: config.serverTimeout,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      });

      const raw = trackResp.data;
      const trackResult = raw?.output?.completeTrackResults?.[0]?.trackResults?.[0];

      if (!trackResult || trackResult.error || trackResult.status === 'ERROR') {
        return {
          provider: PROVIDER_NAME,
          success: false,
          data: {},
          error:
            trackResult?.error?.message || 'Tracking number not found or error returned from FedEx',
          raw,
          duration: Date.now() - start,
        };
      }

      const scanEvents = trackResult.scanEvents || [];
      const events = scanEvents.map((event: any) => {
        const location = event.scanLocation;
        const locationParts = [
          location?.city,
          location?.stateOrProvinceCode,
          location?.postalCode,
          location?.countryCode,
        ].filter(Boolean);

        return {
          date: event.date ? new Date(event.date).toISOString() : new Date().toISOString(),
          status: event.eventDescription || 'Scan Event',
          description: event.eventDescription || undefined,
          location: locationParts.join(', ') || undefined,
          source: PROVIDER_NAME,
        };
      });

      // Sort events oldest to newest
      events.sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime());

      const latestStatus = trackResult.latestStatusDetail || {};
      const statusText = latestStatus.description || 'In Transit';
      const statusCode = latestStatus.code;
      const isDelivered = statusCode === 'DL' || statusText.toLowerCase().includes('delivered');

      const data: ParcelData = {
        tracking_number: query,
        couriers: ['FedEx'],
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
    } catch (error: any) {
      return {
        provider: PROVIDER_NAME,
        success: false,
        data: {},
        error: error.response?.data?.errors?.[0]?.message || error.message || String(error),
        duration: Date.now() - start,
      };
    }
  },
};
