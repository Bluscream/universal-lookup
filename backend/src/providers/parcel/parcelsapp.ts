import axios from 'axios';
import { config } from '../../config.js';
import type { LookupType, ParcelData, Provider, ProviderResult } from '../../types/common.js';

const PROVIDER_NAME = 'parcelsapp';

/**
 * ParcelsApp — Parcel tracking aggregator.
 *
 * Uses the free v1 mobile API endpoint when no API key is set,
 * or the v3 authenticated API when PARCELSAPP_API_KEY is provided.
 */
export const parcelsapp: Provider = {
  name: PROVIDER_NAME,
  isAvailable() {
    return true;
  },

  async lookup(
    query: string,
    _type?: LookupType,
    _originalQuery?: string,
    options?: { postalCode?: string },
  ): Promise<ProviderResult<ParcelData>> {
    const start = Date.now();
    try {
      if (config.parcelsAppApiKey) {
        return await lookupV3(query, start, options);
      }
      return await lookupV1(query, start, options);
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

/** Free v1 mobile API (no key required) */
async function lookupV1(
  query: string,
  start: number,
  options?: { postalCode?: string },
): Promise<ProviderResult> {
  const postcodeParam = options?.postalCode || 'Default';
  const url = `https://parcelsapp.com/api/v1/parcels/${encodeURIComponent(query)}/Auto%20Detect/en/Germany/${encodeURIComponent(postcodeParam)}/android`;

  // Synthesize settings array matching official Android app logic
  const settings: unknown[] = [
    true, // Settings:push
    false, // Settings:subscribed
    1716723120000, // Settings:installedAt
    0, // Settings:goods
    5, // ReviewPromptStats:appOpens
    0, // totalParcels
    false, // dummy/ad-free
    'Pixel 6', // Model
    'oriole', // Device ID
    '89201f99c0d12e4f', // Unique ID
    'Google', // Manufacturer
    'com.android.vending', // Installer
    '3.0.2', // Readable Version
    query, // Tracking Number
  ];

  // Replicate hash_32_gc calculation on settings string
  const jsonStr = JSON.stringify(settings);
  const hash = hash_32_gc(jsonStr, 978);
  settings.push(hash);

  const payload: any[] = [
    {
      slug: 'ahkref',
      data: settings,
    },
  ];

  if (options?.postalCode) {
    payload.push({
      slug: 'extra',
      data: {
        defaultPostalCode: options.postalCode,
        zipcode: options.postalCode,
      },
    });
  }

  const resp = await axios.post(url, payload, {
    timeout: config.serverTimeout,
    headers: {
      'User-Agent': 'ParcelsApp/3.0 (Android)',
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
  });

  const raw = resp.data;

  // v1 returns a single parcel object with states array
  if (!raw || (raw.error && !raw.states)) {
    return {
      provider: PROVIDER_NAME,
      success: false,
      data: {},
      raw,
      error: raw?.error || 'No tracking data',
      duration: Date.now() - start,
    };
  }

  const data: ParcelData = {
    tracking_number: raw.trackingId || raw.tracking_id || query,
    couriers: [raw.slug || raw.carrier || raw.origin].filter(Boolean) as string[],
    status: raw.status || raw.lastState?.status,
    status_description: raw.statusDescription || raw.lastState?.description,
    origin: raw.origin,
    destination: raw.destination,
    estimated_delivery: raw.estimatedDeliveryDate || raw.eta,
    delivered: raw.delivered,
    days_in_transit: raw.daysInTransit,
    events: ((raw.states as Array<Record<string, unknown>>) || [])
      .map((s) => ({
        date: s.date as string,
        status: s.status as string,
        location: s.location as string | undefined,
        description: s.description as string | undefined,
        source: PROVIDER_NAME,
      }))
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()),
  };

  return { provider: PROVIDER_NAME, success: true, data, raw, duration: Date.now() - start };
}

/** JS-equivalent MurmurHash2 (32-bit) hashing function */
function hash_32_gc(text: string, seed: number): number {
  let length = text.length;
  let h = seed ^ length;
  let i = 0;
  while (length >= 4) {
    let k =
      (text.charCodeAt(i) & 0xff) |
      ((text.charCodeAt(i + 1) & 0xff) << 8) |
      ((text.charCodeAt(i + 2) & 0xff) << 16) |
      ((text.charCodeAt(i + 3) & 0xff) << 24);

    k = Math.imul(k, 1540483477);
    k ^= k >>> 24;
    k = Math.imul(k, 1540483477);

    h = Math.imul(h, 1540483477);
    h ^= k;

    length -= 4;
    i += 4;
  }

  switch (length) {
    case 3:
      h ^= (text.charCodeAt(i + 2) & 0xff) << 16;
      h ^= (text.charCodeAt(i + 1) & 0xff) << 8;
      h ^= text.charCodeAt(i) & 0xff;
      h = Math.imul(h, 1540483477);
      break;
    case 2:
      h ^= (text.charCodeAt(i + 1) & 0xff) << 8;
      h ^= text.charCodeAt(i) & 0xff;
      h = Math.imul(h, 1540483477);
      break;
    case 1:
      h ^= text.charCodeAt(i) & 0xff;
      h = Math.imul(h, 1540483477);
      break;
  }

  h ^= h >>> 13;
  h = Math.imul(h, 1540483477);
  h ^= h >>> 15;
  return h >>> 0;
}

/** Authenticated v3 API (requires key) */
async function lookupV3(
  query: string,
  start: number,
  options?: { postalCode?: string },
): Promise<ProviderResult> {
  // Step 1: Initiate tracking
  const initResp = await axios.post(
    'https://parcelsapp.com/api/v3/shipments/tracking',
    {
      shipments: [
        {
          trackingId: query,
          language: 'en',
          country: 'Germany',
          postalCode: options?.postalCode,
          zipcode: options?.postalCode,
          zip: options?.postalCode,
          postcode: options?.postalCode,
        },
      ],
      apiKey: config.parcelsAppApiKey,
    },
    { timeout: config.serverTimeout },
  );

  const uuid = initResp.data?.uuid;
  if (!uuid) {
    return {
      provider: PROVIDER_NAME,
      success: false,
      data: {},
      raw: initResp.data,
      error: 'No UUID returned',
      duration: Date.now() - start,
    };
  }

  // Step 2: Poll for results (max 5 attempts with 2s delay)
  let trackingData:
    | (Record<string, unknown> & { shipments?: Array<Record<string, unknown>> })
    | null = null;
  for (let i = 0; i < 5; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const pollResp = await axios.get(
      `https://parcelsapp.com/api/v3/shipments?apiKey=${config.parcelsAppApiKey}&uuid=${uuid}`,
      {
        timeout: config.serverTimeout,
      },
    );
    if (pollResp.data?.done || pollResp.data?.shipments?.length) {
      trackingData = pollResp.data;
      break;
    }
  }

  if (!trackingData?.shipments?.length) {
    return {
      provider: PROVIDER_NAME,
      success: false,
      data: {},
      raw: trackingData,
      error: 'Tracking data not available',
      duration: Date.now() - start,
    };
  }

  const ship = trackingData.shipments[0];
  const data: ParcelData = {
    tracking_number: ship.trackingId as string | undefined,
    couriers: [(ship.slug as string) || (ship.carrier as string)].filter(Boolean),
    status: ship.status as string | undefined,
    status_description: ship.statusDescription as string | undefined,
    origin: ship.origin as string | undefined,
    destination: ship.destination as string | undefined,
    estimated_delivery: ship.estimatedDeliveryDate as string | undefined,
    events: ((ship.states as Array<Record<string, unknown>>) || [])
      .map((s) => ({
        date: s.date as string,
        status: s.status as string,
        location: s.location as string | undefined,
        description: s.description as string | undefined,
        source: PROVIDER_NAME,
      }))
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()),
  };

  return {
    provider: PROVIDER_NAME,
    success: true,
    data,
    raw: trackingData,
    duration: Date.now() - start,
  };
}
