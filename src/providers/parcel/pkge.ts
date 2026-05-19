import * as cheerio from 'cheerio';
import { scrapeWithPuppeteer } from '../../lib/puppeteer.js';
import type { LookupType, Provider, ProviderResult } from '../../types/common.js';

const PROVIDER_NAME = 'pkge';

/**
 * PKGE.net Package Tracking Provider.
 * No API key required. Scrapes the web interface cleanly.
 */
export const pkge: Provider = {
  name: PROVIDER_NAME,
  isAvailable() {
    return true;
  },

  async lookup(query: string, _type?: LookupType): Promise<ProviderResult> {
    const start = Date.now();
    const url = `https://pkge.net/parcel/${encodeURIComponent(query)}`;
    
    try {
      const html = await scrapeWithPuppeteer(url);
      if (!html || html.trim().length === 0) {
        return {
          provider: PROVIDER_NAME,
          success: false,
          data: {},
          error: 'Empty response fetched from pkge.net',
          duration: Date.now() - start,
        };
      }

      const $ = cheerio.load(html);

      // Check if we hit a 404 page
      const title = $('title').text().trim();
      if (title.includes('404 error') || title.includes('Page not found') || $('.page-404').length > 0) {
        return {
          provider: PROVIDER_NAME,
          success: false,
          data: {},
          error: 'Package not found on pkge.net',
          duration: Date.now() - start,
        };
      }

      // 1. Core Status
      const statusText = $('.package-status-header').text().trim() || 'Unknown';
      const trackingNumber = $('.package-status-info-code').text().trim() || query;
      const infoText = $('.package-status-info-box').text().trim().replace(/\s+/g, ' ') || '';

      // 2. Couriers (Delivery Services)
      const couriers: string[] = [];
      $('#parcel-couriers span a').each((_, el) => {
        const name = $(el).text().trim();
        if (name) couriers.push(name);
      });

      // 3. Metadata from info list
      let origin = '';
      let destination = '';
      let weight = '';
      let estimatedDelivery = '';

      $('.package-info-list li').each((_, el) => {
        const key = $(el).find('.package-info-list-title').text().trim().toLowerCase().replace(/:$/, '');
        const val = $(el).find('.package-info-list-content').text().trim().replace(/\s+/g, ' ');
        if (key.includes('shipper address')) {
          origin = val !== '—' ? val : '';
        } else if (key.includes('receiver address')) {
          destination = val !== '—' ? val : '';
        } else if (key.includes('weight')) {
          weight = val;
        }
      });

      const daysInTransit = $('.package-info-delivery-days-value').text().trim();
      const estDeliveryVal = $('.package-info-delivery-target-value').text().trim().replace(/\s+/g, ' ');
      if (estDeliveryVal) {
        estimatedDelivery = estDeliveryVal;
      }

      // 4. Events Timeline
      const events: Array<{
        date: string;
        status: string;
        location?: string;
        courier?: string;
      }> = [];

      $('.package-timeline .package-timeline__item').each((_, el) => {
        const time = $(el).find('.package-timeline__time').text().trim().replace(/\s+/g, ' ');
        const eventTitle = $(el).find('.package-timeline__title').text().trim();
        const desc = $(el).find('.package-timeline__description').text().trim();
        const post = $(el).find('.package-timeline__post').text().trim();

        if (time || eventTitle) {
          events.push({
            date: time,
            status: eventTitle || 'Update',
            ...(desc ? { location: desc } : {}),
            ...(post ? { courier: post } : {}),
          });
        }
      });

      const data: Record<string, unknown> = {
        tracking_number: trackingNumber,
        carrier: couriers.length > 0 ? couriers[0] : 'Unknown',
        couriers,
        status: statusText,
        status_description: infoText,
        origin,
        destination,
        weight,
        estimated_delivery: estimatedDelivery,
        days_in_transit: daysInTransit,
        events,
      };

      return {
        provider: PROVIDER_NAME,
        success: true,
        data,
        raw: { html_length: html.length },
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
