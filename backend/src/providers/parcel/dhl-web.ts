import axios from 'axios';
import { config } from '../../config.js';
import type { LookupType, ParcelData, Provider, ProviderResult } from '../../types/common.js';

const PROVIDER_NAME = 'dhl-web';

/**
 * DHL Website Tracking — uses the DHL.de internal SPA API.
 * No API key required. Returns real German tracking data.
 *
 * Discovered from AdGuard HAR capture:
 *   https://www.dhl.de/int-verfolgen/data/search?piececode=TRACKING_NUMBER&language=de
 */
export const dhlWeb: Provider = {
  name: PROVIDER_NAME,
  isAvailable() {
    return true;
  },

  async lookup(query: string, _type?: LookupType): Promise<ProviderResult<ParcelData>> {
    const start = Date.now();
    try {
      const url = `https://www.dhl.de/int-verfolgen/data/search?piececode=${encodeURIComponent(query)}&language=de`;

      const resp = await axios.get(url, {
        timeout: config.serverTimeout,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Accept: 'application/json',
          'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8',
          Referer: 'https://www.dhl.de/de/privatkunden/pakete-empfangen/verfolgen.html',
        },
      });

      const raw = resp.data;
      const sendung = raw?.sendungen?.[0];

      if (!sendung) {
        return {
          provider: PROVIDER_NAME,
          success: false,
          data: {},
          raw,
          error: 'No shipment found',
          duration: Date.now() - start,
        };
      }

      // Check if tracking data is actually available
      if (sendung.sendungNichtGefunden?.keineDatenVerfuegbar) {
        return {
          provider: PROVIDER_NAME,
          success: false,
          data: {},
          raw,
          error: 'No tracking data available for this number',
          duration: Date.now() - start,
        };
      }

      const details = sendung.sendungsdetails || {};
      const verlauf = details.sendungsverlauf || {};
      const zustellung = details.zustellung || {};

      const data: ParcelData = {
        tracking_number: sendung.id || query,
        couriers: ['DHL'],
        status: verlauf.status,
        delivered: !!details.istZugestellt,
        progress: verlauf.fortschritt,
        progress_max: verlauf.maximalFortschritt,
        destination_country: details.zielland,
        is_return: !!details.retoure || !!details.ruecksendung,
        parcel_type: details.kleinpaket
          ? 'Kleinpaket'
          : details.expressSendung
            ? 'Express'
            : details.quelle === 'PAKET'
              ? 'Paket'
              : details.quelle,
      };

      // Delivery info
      if (zustellung.empfaenger?.name) {
        data.delivered_to = zustellung.empfaenger.name;
      }
      if (zustellung.zugestelltAnAndereAnwesendePerson) {
        data.delivered_to_other_person = true;
      }

      // Events
      const events = verlauf.events;
      if (Array.isArray(events) && events.length > 0) {
        // biome-ignore lint/suspicious/noExplicitAny: External API response
        data.events = events
          .map((e: any) => ({
            date: e.datum,
            status: e.status,
            is_return: e.ruecksendung || false,
            source: PROVIDER_NAME,
          }))
          .sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime());
      }

      return { provider: PROVIDER_NAME, success: true, data, raw, duration: Date.now() - start };
    } catch (error: unknown) {
      const err = error as { response?: { status: number } };
      if (err.response?.status === 429) {
        return {
          provider: PROVIDER_NAME,
          success: false,
          data: {},
          error: 'Rate limited by DHL',
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
