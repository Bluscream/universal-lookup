import axios from 'axios';
import { config } from '../../config.js';
import type { Provider, ProviderResult } from '../../types/common.js';

const PROVIDER_NAME = 'parcelsapp';

/**
 * ParcelsApp — Parcel tracking aggregator.
 *
 * Uses the free v1 mobile API endpoint when no API key is set,
 * or the v3 authenticated API when PARCELSAPP_API_KEY is provided.
 */
export const parcelsapp: Provider = {
  name: PROVIDER_NAME,
  isAvailable() { return true; },

  async lookup(query: string): Promise<ProviderResult> {
    const start = Date.now();
    try {
      if (config.parcelsAppApiKey) {
        return await lookupV3(query, start);
      }
      return await lookupV1(query, start);
    } catch (error) {
      return { provider: PROVIDER_NAME, success: false, data: {}, error: error instanceof Error ? error.message : String(error), duration: Date.now() - start };
    }
  },
};

/** Free v1 mobile API (no key required) */
async function lookupV1(query: string, start: number): Promise<ProviderResult> {
  const url = `https://parcelsapp.com/api/v1/parcels/${encodeURIComponent(query)}/Auto%20Detect/en/Germany/Default/android`;

  const resp = await axios.get(url, {
    timeout: config.providerTimeout,
    headers: {
      'User-Agent': 'ParcelsApp/3.0 (Android)',
      'Accept': 'application/json',
    },
  });

  const raw = resp.data;

  // v1 returns a single parcel object with states array
  if (!raw || (raw.error && !raw.states)) {
    return { provider: PROVIDER_NAME, success: false, data: {}, raw, error: raw?.error || 'No tracking data', duration: Date.now() - start };
  }

  const data: Record<string, unknown> = {
    tracking_number: raw.trackingId || raw.tracking_id || query,
    carrier: raw.slug || raw.carrier || raw.origin,
    status: raw.status || raw.lastState?.status,
    status_description: raw.statusDescription || raw.lastState?.description,
    origin: raw.origin,
    destination: raw.destination,
    estimated_delivery: raw.estimatedDeliveryDate || raw.eta,
    delivered: raw.delivered,
    days_in_transit: raw.daysInTransit,
    events: raw.states?.map((s: any) => ({
      date: s.date,
      status: s.status,
      location: s.location,
      description: s.description,
    })),
  };

  return { provider: PROVIDER_NAME, success: true, data, raw, duration: Date.now() - start };
}

/** Authenticated v3 API (requires key) */
async function lookupV3(query: string, start: number): Promise<ProviderResult> {
  // Step 1: Initiate tracking
  const initResp = await axios.post('https://parcelsapp.com/api/v3/shipments/tracking', {
    shipments: [{ trackingId: query, language: 'en', country: 'Germany' }],
    apiKey: config.parcelsAppApiKey,
  }, { timeout: config.providerTimeout });

  const uuid = initResp.data?.uuid;
  if (!uuid) {
    return { provider: PROVIDER_NAME, success: false, data: {}, raw: initResp.data, error: 'No UUID returned', duration: Date.now() - start };
  }

  // Step 2: Poll for results (max 5 attempts with 2s delay)
  let trackingData: any = null;
  for (let i = 0; i < 5; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const pollResp = await axios.get(`https://parcelsapp.com/api/v3/shipments?apiKey=${config.parcelsAppApiKey}&uuid=${uuid}`, {
      timeout: config.providerTimeout,
    });
    if (pollResp.data?.done || pollResp.data?.shipments?.length) {
      trackingData = pollResp.data;
      break;
    }
  }

  if (!trackingData?.shipments?.length) {
    return { provider: PROVIDER_NAME, success: false, data: {}, raw: trackingData, error: 'Tracking data not available', duration: Date.now() - start };
  }

  const ship = trackingData.shipments[0];
  const data: Record<string, unknown> = {
    tracking_number: ship.trackingId,
    carrier: ship.slug || ship.carrier,
    status: ship.status,
    status_description: ship.statusDescription,
    origin: ship.origin,
    destination: ship.destination,
    estimated_delivery: ship.estimatedDeliveryDate,
    events: ship.states?.map((s: any) => ({
      date: s.date, status: s.status, location: s.location, description: s.description,
    })),
  };

  return { provider: PROVIDER_NAME, success: true, data, raw: trackingData, duration: Date.now() - start };
}
