import axios from 'axios';
import { config } from '../../config.js';
import type { LookupType, Provider, ProviderResult, ParcelData } from '../../types/common.js';

const PROVIDER_NAME = '17track';

interface SeventeenTrackCheckpoint {
  a: string; // timestamp
  z: string; // status text
  c?: string; // location
}

interface SeventeenTrackStage {
  z?: SeventeenTrackCheckpoint[];
}

interface SeventeenTrackInfo {
  number?: string;
  carrier?: number;
  error?: {
    code?: string | number;
    message?: string;
  };
  track?: {
    e?: number; // status code
    z0?: SeventeenTrackStage; // origin
    z1?: SeventeenTrackStage; // intl
    z2?: SeventeenTrackStage; // destination
  };
}

interface SeventeenTrackRawResponse {
  data?: {
    accepted?: SeventeenTrackInfo[];
    rejected?: SeventeenTrackInfo[];
  };
}

/**
 * 17TRACK — Universal parcel tracking aggregator via official API.
 *
 * Uses the 17TRACK REST API v2.4 to register and retrieve tracking information
 * across hundreds of carriers worldwide.
 *
 * Docs: https://api.17track.net
 * Requires: SEVENTEEN_TRACK_API_KEY environment variable.
 */

// ── Carrier Mapping (commented out for future use) ──
// Maps common carrier names to 17TRACK's internal carrier codes.
// See full list at: https://res.17track.net/asset/carrier/info/apicarrier.all.json
//
// const CARRIER_MAP: Record<string, number> = {
//   'dhl': 100001,        // DHL
//   'dhl-express': 100001,
//   'dhl-ecommerce': 100001,
//   'fedex': 100003,      // FedEx
//   'ups': 100002,        // UPS
//   'usps': 21051,        // USPS
//   'dpd': 100007,        // DPD
//   'gls': 100005,        // GLS
//   'hermes': 100009,     // Hermes (Evri)
//   'tnt': 100004,        // TNT
//   'royal-mail': 190001, // Royal Mail
//   'china-post': 3011,   // China Post
//   'yanwen': 190012,     // Yanwen
//   'cainiao': 190271,    // Cainiao
//   'amazon': 100143,     // Amazon Logistics
//   'deutsche-post': 100001, // Deutsche Post (same as DHL)
// };
//
// /**
//  * Attempt to resolve a carrier name to a 17TRACK carrier code.
//  * Returns undefined if no mapping is found (auto-detect will be used).
//  */
// function resolveCarrierCode(carrier?: string): number | undefined {
//   if (!carrier) return undefined;
//   const normalized = carrier.toLowerCase().trim();
//   return CARRIER_MAP[normalized];
// }

export const seventeenTrack: Provider = {
  name: PROVIDER_NAME,
  isAvailable() {
    return !!config.seventeenTrackApiKey;
  },

  async lookup(query: string, _type?: LookupType): Promise<ProviderResult<ParcelData>> {
    const start = Date.now();
    const apiKey = config.seventeenTrackApiKey;

    if (!apiKey) {
      return {
        provider: PROVIDER_NAME,
        success: false,
        data: {},
        error: 'Missing 17TRACK API key',
        duration: Date.now() - start,
      };
    }

    const headers = {
      'Content-Type': 'application/json',
      '17token': apiKey,
    };

    try {
      // Step 1: Register the tracking number (idempotent — re-registering is fine)
      await axios.post('https://api.17track.net/track/v2.2/register', [{ number: query.trim() }], {
        headers,
        timeout: config.serverTimeout,
      });

      // Step 2: Retrieve tracking info
      const trackResp = await axios.post(
        'https://api.17track.net/track/v2.2/gettrackinfo',
        [{ number: query.trim() }],
        { headers, timeout: config.serverTimeout },
      );

      const raw = trackResp.data as SeventeenTrackRawResponse;
      const accepted = raw?.data?.accepted;
      const rejected = raw?.data?.rejected;

      if (rejected?.length && !accepted?.length) {
        const reason = String(
          rejected[0]?.error?.message || rejected[0]?.error?.code || 'Tracking number rejected',
        );
        return {
          provider: PROVIDER_NAME,
          success: false,
          data: {},
          raw,
          error: reason,
          duration: Date.now() - start,
        };
      }

      const info = accepted?.[0];
      if (!info) {
        return {
          provider: PROVIDER_NAME,
          success: false,
          data: {},
          raw,
          error: 'No tracking information returned',
          duration: Date.now() - start,
        };
      }

      const track = info.track ?? {};
      const lastEvent = track.z0?.z ?? track.z1?.z ?? track.z2?.z;
      const latestCheckpoint = lastEvent?.[0];

      // Map 17TRACK status codes to human-readable strings
      const statusMap: Record<number, string> = {
        0: 'Not Found',
        10: 'In Transit',
        20: 'Expired',
        30: 'Pick Up',
        35: 'Undelivered',
        40: 'Delivered',
        50: 'Alert',
      };

      const allEvents: Array<{ date: string; status: string; location?: string; source: string }> = [];

      // Collect events from all tracking stages (z0 = origin, z1 = intl, z2 = destination)
      for (const stage of [track.z0, track.z1, track.z2]) {
        if (stage?.z && Array.isArray(stage.z)) {
          for (const evt of stage.z) {
            allEvents.push({
              date: evt.a, // timestamp
              status: evt.z, // status text
              location: evt.c || undefined, // location
              source: PROVIDER_NAME,
            });
          }
        }
      }

      // Sort events oldest-first (so last is most recent)
      allEvents.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

      const statusCode = info.track?.e ?? 0;
      const couriers = ['17track'];
      if (info.carrier) {
        couriers.push(String(info.carrier));
      }

      const data: ParcelData = {
        tracking_number: info.number || query,
        couriers,
        status: statusMap[statusCode] || `Unknown (${statusCode})`,
        status_code: statusCode,
        delivered: statusCode === 40,
        events: allEvents,
      };

      return {
        provider: PROVIDER_NAME,
        success: true,
        data,
        raw,
        duration: Date.now() - start,
      };
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
