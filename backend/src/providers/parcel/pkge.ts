import { PkgeClient } from 'pkge-client';
import type { LookupType, ParcelData, Provider, ProviderResult } from '../../types/common.js';

const PROVIDER_NAME = 'pkge';

interface PkgeCheckpoint {
  date?: string;
  title?: string;
  location?: string;
  courier?: { name?: string };
}

interface PkgeCourier {
  name: string;
}

interface PkgeRawResponse {
  track_number?: string;
  courier?: { name?: string };
  couriers?: PkgeCourier[];
  last_status?: string;
  status_description?: string;
  origin?: string;
  destination?: string;
  weight?: string;
  est_delivery_date_from?: string;
  est_delivery_date_to?: string;
  days_on_way?: number;
  checkpoints?: PkgeCheckpoint[];
}

// Initialize a shared instance of the client.
// We call initKeys() on first lookup to ensure we have the latest decryption keys.
const client = new PkgeClient();
let keysInitialized = false;

/**
 * PKGE.net Package Tracking Provider.
 * Uses the reverse-engineered pkge-client library for fast API access without Puppeteer.
 */
export const pkge: Provider = {
  name: PROVIDER_NAME,
  isAvailable() {
    return true;
  },

  async lookup(query: string, _type?: LookupType): Promise<ProviderResult<ParcelData>> {
    const start = Date.now();

    try {
      // Lazy initialize the dynamic keys on the first request
      if (!keysInitialized) {
        await client.initKeys();
        keysInitialized = true;
      }

      const trackingData = (await client.getTrackingInitial(query)) as PkgeRawResponse | null;

      if (!trackingData) {
        return {
          provider: PROVIDER_NAME,
          success: false,
          data: {},
          error: 'Empty response fetched from pkge.net',
          duration: Date.now() - start,
        };
      }

      // Map API checkpoints to standardized events
      const events = (trackingData.checkpoints || [])
        .map((cp) => ({
          date: cp.date || '',
          status: cp.title || 'Update',
          ...(cp.location ? { location: cp.location } : {}),
          ...(cp.courier?.name ? { courier: cp.courier.name } : {}),
          source: PROVIDER_NAME,
        }))
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

      // Extract couriers
      const couriers = (trackingData.couriers || []).map((c) => c.name);
      if (couriers.length === 0 && trackingData.courier?.name) {
        couriers.push(trackingData.courier.name);
      }

      // Calculate estimated delivery if available
      let estimatedDelivery = '';
      if (trackingData.est_delivery_date_from && trackingData.est_delivery_date_to) {
        estimatedDelivery = `${trackingData.est_delivery_date_from} - ${trackingData.est_delivery_date_to}`;
      } else if (trackingData.est_delivery_date_from) {
        estimatedDelivery = trackingData.est_delivery_date_from;
      }

      const data: ParcelData = {
        tracking_number: trackingData.track_number || query,
        couriers,
        status: trackingData.last_status || 'Unknown',
        status_description: trackingData.status_description || '',
        origin: trackingData.origin || '',
        destination: trackingData.destination || '',
        weight: trackingData.weight || '',
        estimated_delivery: estimatedDelivery,
        days_in_transit:
          trackingData.days_on_way != null ? trackingData.days_on_way.toString() : '',
        events,
      };

      return {
        provider: PROVIDER_NAME,
        success: true,
        data,
        raw: trackingData,
        duration: Date.now() - start,
      };
    } catch (error) {
      // Differentiate between a 404/not found vs an actual API error
      const errorMsg = error instanceof Error ? error.message : String(error);
      const isNotFound = errorMsg.includes('404') || errorMsg.includes('not find');

      return {
        provider: PROVIDER_NAME,
        success: false,
        data: {},
        error: isNotFound ? 'Package not found on pkge.net' : errorMsg,
        duration: Date.now() - start,
      };
    }
  },
};
