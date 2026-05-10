import axios from 'axios';
import { config } from '../../config.js';
import type { LookupType, Provider, ProviderResult } from '../../types/common.js';

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
    return true;
  },

  async lookup(query: string, _type?: LookupType): Promise<ProviderResult> {
    const start = Date.now();
    try {
      const apiKey = config.dhlApiKey || 'demo-key';
      const url = `https://api-eu.dhl.com/track/shipments?trackingNumber=${encodeURIComponent(query)}`;

      const resp = await axios.get(url, {
        timeout: config.providerTimeout,
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

      const data: Record<string, unknown> = {
        tracking_number: shipment.id || query,
        carrier: 'DHL',
        service: shipment.service,
        status: shipment.status?.status,
        status_code: shipment.status?.statusCode,
        status_description: shipment.status?.description,
        status_timestamp: shipment.status?.timestamp,
        status_location: shipment.status?.location?.address?.addressLocality,
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
        // biome-ignore lint/suspicious/noExplicitAny: External API response
        events: shipment.events?.map((e: any) => ({
          date: e.timestamp,
          status: e.status,
          status_code: e.statusCode,
          description: e.description,
          location: e.location?.address?.addressLocality,
        })),
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
