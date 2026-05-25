import { PkgeClient } from 'pkge-client';
import type { LookupType, Provider, ProviderResult } from '../../types/common.js';

const PROVIDER_NAME = 'pkge';

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

  async lookup(query: string, _type?: LookupType): Promise<ProviderResult> {
    const start = Date.now();
    
    try {
      // Lazy initialize the dynamic keys on the first request
      if (!keysInitialized) {
        await client.initKeys();
        keysInitialized = true;
      }

      const trackingData = await client.getTrackingInitial(query);

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
      const events = (trackingData.checkpoints || []).map((cp: any) => ({
        date: cp.date || '',
        status: cp.title || 'Update',
        ...(cp.location ? { location: cp.location } : {}),
        ...(cp.courier?.name ? { courier: cp.courier.name } : {}),
      }));

      // Extract couriers
      const couriers = (trackingData.couriers || []).map((c: any) => c.name);
      
      // Calculate estimated delivery if available
      let estimatedDelivery = '';
      if (trackingData.est_delivery_date_from && trackingData.est_delivery_date_to) {
        estimatedDelivery = `${trackingData.est_delivery_date_from} - ${trackingData.est_delivery_date_to}`;
      } else if (trackingData.est_delivery_date_from) {
        estimatedDelivery = trackingData.est_delivery_date_from;
      }

      const data: Record<string, unknown> = {
        tracking_number: trackingData.track_number || query,
        carrier: couriers.length > 0 ? couriers[0] : (trackingData.courier?.name || 'Unknown'),
        couriers,
        status: trackingData.last_status || 'Unknown',
        status_description: trackingData.status_description || '',
        origin: trackingData.origin || '',
        destination: trackingData.destination || '',
        weight: trackingData.weight || '',
        estimated_delivery: estimatedDelivery,
        days_in_transit: trackingData.days_on_way != null ? trackingData.days_on_way.toString() : '',
        events,
      };

      return {
        provider: PROVIDER_NAME,
        success: true,
        data,
        raw: trackingData,
        duration: Date.now() - start,
      };
    } catch (error: any) {
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
