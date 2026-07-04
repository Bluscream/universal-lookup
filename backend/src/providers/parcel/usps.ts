import axios from 'axios';
import * as cheerio from 'cheerio';
import { config } from '../../config.js';
import type { LookupType, ParcelData, Provider, ProviderResult } from '../../types/common.js';

const PROVIDER_NAME = 'usps';

export const usps: Provider = {
  name: PROVIDER_NAME,
  isAvailable() {
    return !!config.uspsUsername;
  },

  async lookup(query: string, _type?: LookupType): Promise<ProviderResult<ParcelData>> {
    const start = Date.now();
    try {
      const username = config.uspsUsername;
      if (!username) {
        throw new Error('Missing USPS Username');
      }

      const xmlRequest = `<TrackRequest USERID="${username}"><TrackID ID="${query}"></TrackID></TrackRequest>`;
      const url = `https://secure.shippingapis.com/ShippingAPI.dll?API=TrackV2&XML=${encodeURIComponent(xmlRequest)}`;

      const response = await axios.get(url, {
        timeout: config.serverTimeout,
      });

      const $ = cheerio.load(response.data, { xmlMode: true });

      // Check for top-level errors or item-level errors
      const errorEl = $('Error');
      if (errorEl.length > 0) {
        return {
          provider: PROVIDER_NAME,
          success: false,
          data: {},
          error: errorEl.find('Description').text() || 'USPS API Error',
          raw: response.data,
          duration: Date.now() - start,
        };
      }

      const trackInfo = $('TrackInfo');
      const trackInfoError = trackInfo.find('Error');
      if (trackInfoError.length > 0) {
        return {
          provider: PROVIDER_NAME,
          success: false,
          data: {},
          error: trackInfoError.find('Description').text() || 'USPS TrackInfo Error',
          raw: response.data,
          duration: Date.now() - start,
        };
      }

      const summary = trackInfo.find('TrackSummary');
      if (summary.length === 0) {
        return {
          provider: PROVIDER_NAME,
          success: false,
          data: {},
          error: 'No tracking information found',
          raw: response.data,
          duration: Date.now() - start,
        };
      }

      const parseEvent = (el: cheerio.Cheerio<any>) => {
        const eventText = el.find('Event').text() || '';
        const eventDateText = el.find('EventDate').text() || '';
        const eventTimeText = el.find('EventTime').text() || '';
        const city = el.find('EventCity').text() || '';
        const state = el.find('EventState').text() || '';
        const zip = el.find('EventZIPCode').text() || '';
        const country = el.find('EventCountry').text() || '';

        const locationParts = [city, state, zip, country].filter(Boolean);
        const location = locationParts.join(', ');

        let dateStr = '';
        if (eventDateText) {
          const combined = eventTimeText ? `${eventDateText} ${eventTimeText}` : eventDateText;
          const parsedDate = new Date(combined);
          if (!Number.isNaN(parsedDate.getTime())) {
            dateStr = parsedDate.toISOString();
          }
        }

        return {
          date: dateStr || new Date().toISOString(),
          status: eventText,
          description: eventText,
          location,
          source: PROVIDER_NAME,
        };
      };

      const events: Array<{
        date: string;
        status: string;
        description?: string;
        location?: string;
        source?: string;
      }> = [];

      // Add summary event first
      events.push(parseEvent(summary));

      // Add historical detail events
      trackInfo.find('TrackDetail').each((_, el) => {
        events.push(parseEvent($(el)));
      });

      // Sort events oldest to newest
      events.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

      const latestEvent = events[events.length - 1] || {};
      const statusText = latestEvent.status || 'In Transit';
      const isDelivered = statusText.toLowerCase().includes('delivered');

      const data: ParcelData = {
        tracking_number: query,
        couriers: ['USPS'],
        status: statusText,
        status_description: statusText,
        delivered: isDelivered,
        events,
      };

      return {
        provider: PROVIDER_NAME,
        success: true,
        data,
        raw: response.data,
        duration: Date.now() - start,
      };
    } catch (error: any) {
      return {
        provider: PROVIDER_NAME,
        success: false,
        data: {},
        error: error.message || String(error),
        duration: Date.now() - start,
      };
    }
  },
};
