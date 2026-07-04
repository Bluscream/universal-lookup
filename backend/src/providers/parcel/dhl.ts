import axios from 'axios';
import { config } from '../../config.js';
import type { LookupType, ParcelData, Provider, ProviderResult } from '../../types/common.js';

const PROVIDER_NAME = 'dhl';

/**
 * DHL Tracking API — official DHL shipment tracking.
 * Uses the free demo key by default, can be upgraded with a DHL developer key.
 *
 * Docs: https://developer.dhl.com/api-reference/shipment-tracking
 */
export const dhl: Provider = {
  name: PROVIDER_NAME,
  isAvailable() {
    return !!config.dhlApiKey;
  },

  async lookup(query: string, _type?: LookupType): Promise<ProviderResult<ParcelData>> {
    const start = Date.now();
    try {
      const apiKey = config.dhlApiKey;
      if (!apiKey) {
        throw new Error('Missing DHL API Key');
      }
      const url = `https://api-eu.dhl.com/track/shipments?trackingNumber=${encodeURIComponent(query)}`;

      const resp = await axios.get(url, {
        timeout: config.serverTimeout,
        headers: {
          'DHL-API-Key': apiKey,
        },
      });

      const raw = resp.data;
      const shipment = raw?.shipments?.[0];
      if (!shipment) {
        return {
          provider: PROVIDER_NAME,
          success: false,
          data: {},
          raw,
          error: 'No shipment found',
          duration: Date.now() - start,
        };
      }

      const data: ParcelData = {
        tracking_number: shipment.id || query,
        couriers: ['DHL'],
        service: shipment.service,
        status: shipment.status?.status,
        status_code: shipment.status?.statusCode,
        status_description: shipment.status?.description,
        status_timestamp: shipment.status?.timestamp,
        status_location: shipment.status?.location?.address?.addressLocality,
        delivered: shipment.status?.statusCode?.toLowerCase() === 'delivered',
        is_return: shipment.status?.statusCode?.toLowerCase() === 'returned',
        origin_country: shipment.origin?.address?.countryCode,
        origin_city: shipment.origin?.address?.addressLocality,
        origin_postal: shipment.origin?.address?.postalCode,
        destination_country: shipment.destination?.address?.countryCode,
        destination_city: shipment.destination?.address?.addressLocality,
        destination_postal: shipment.destination?.address?.postalCode,
        estimated_delivery: shipment.details?.estimatedDeliveryDate,
        weight: shipment.details?.weight
          ? `${shipment.details.weight.value} ${shipment.details.weight.unitText}`
          : undefined,
        events: ((shipment.events as Array<Record<string, unknown>>) || [])
          .map((e) => {
            const address = (e.location as Record<string, unknown>)?.address as
              | Record<string, unknown>
              | undefined;
            return {
              date: e.timestamp as string,
              status: e.status as string,
              status_code: e.statusCode as string | undefined,
              description: e.description as string | undefined,
              location: address?.addressLocality as string | undefined,
              source: PROVIDER_NAME,
            };
          })
          .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()),
      };

      return { provider: PROVIDER_NAME, success: true, data, raw, duration: Date.now() - start };
    } catch (error: unknown) {
      const err = error as { response?: { status: number } };
      // DHL API returns 404 when tracking number is not found or wrong format
      if (err.response?.status === 404) {
        return {
          provider: PROVIDER_NAME,
          success: false,
          data: {},
          error: 'Tracking number not found',
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
