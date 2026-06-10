import puppeteer, { type Browser, type Page } from 'puppeteer';
import crypto from 'node:crypto';
import path from 'node:path';
import { config } from '../../config.js';
import { resolvePuppeteerExecutablePath } from '../../lib/puppeteer.js';
import type { LookupType, ParcelData, Provider, ProviderResult } from '../../types/common.js';
import fs from 'node:fs';

const PROVIDER_NAME = 'amazon';

function base32Decode(base32: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = base32.toUpperCase().replace(/=+$/, '');
  const length = clean.length;
  let bits = 0;
  let value = 0;
  let index = 0;
  const buffer = Buffer.alloc(Math.floor((length * 5) / 8));

  for (let i = 0; i < length; i++) {
    const val = alphabet.indexOf(clean[i]);
    if (val === -1) throw new Error('Invalid Base32 character');
    value = (value << 5) | val;
    bits += 5;
    if (bits >= 8) {
      buffer[index++] = (value >>> (bits - 8)) & 255;
      bits -= 8;
    }
  }
  return buffer;
}

export function generateTOTP(secret: string): string {
  const key = base32Decode(secret.replace(/\s+/g, ''));
  const epoch = Math.floor(Date.now() / 1000);
  const counter = Math.floor(epoch / 30);

  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeUInt32BE(counter, 4);

  const hmac = crypto.createHmac('sha1', key);
  hmac.update(counterBuffer);
  const hash = hmac.digest();

  const offset = hash[hash.length - 1] & 0xf;
  const code =
    ((hash[offset] & 0x7f) << 24) |
    ((hash[offset + 1] & 0xff) << 16) |
    ((hash[offset + 2] & 0xff) << 8) |
    (hash[offset + 3] & 0xff);

  const otp = code % 1000000;
  return otp.toString().padStart(6, '0');
}

export function parseGermanDate(dateStr: string): Date {
  const now = new Date();
  const year = now.getFullYear();

  const cleanStr = dateStr
    .replace(
      /^(Montag|Dienstag|Mittwoch|Donnerstag|Freitag|Samstag|Sonntag|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),\s*/i,
      '',
    )
    .trim();

  const monthsGerman = [
    'januar',
    'februar',
    'märz',
    'april',
    'mai',
    'juni',
    'juli',
    'august',
    'september',
    'oktober',
    'november',
    'dezember',
  ];
  const monthsEnglish = [
    'january',
    'february',
    'march',
    'april',
    'may',
    'june',
    'july',
    'august',
    'september',
    'october',
    'november',
    'december',
  ];

  let parsed = new Date(dateStr);
  if (!Number.isNaN(parsed.getTime())) {
    if (parsed.getFullYear() < 2020) {
      parsed.setFullYear(year);
    }
    return parsed;
  }

  const match = cleanStr.match(/^(\d+)(?:\.|\b)\s+([^\s\d,]+)(?:\s+(\d+):(\d+))?/i);
  if (match) {
    const day = parseInt(match[1], 10);
    const monthName = match[2].toLowerCase();
    const hour = match[3] ? parseInt(match[3], 10) : 0;
    const min = match[4] ? parseInt(match[4], 10) : 0;

    let monthIdx = monthsGerman.findIndex((m) => monthName.startsWith(m));
    if (monthIdx === -1) {
      monthIdx = monthsEnglish.findIndex((m) => monthName.startsWith(m));
    }
    if (monthIdx === -1) {
      const shortMonths = [
        'jan',
        'feb',
        'mar',
        'apr',
        'may',
        'jun',
        'jul',
        'aug',
        'sep',
        'oct',
        'nov',
        'dec',
      ];
      monthIdx = shortMonths.findIndex((m) => monthName.startsWith(m));
    }

    if (monthIdx !== -1) {
      const d = new Date(year, monthIdx, day, hour, min, 0, 0);
      if (d.getTime() > now.getTime() + 1000 * 60 * 60 * 24 * 7) {
        d.setFullYear(year - 1);
      }
      return d;
    }
  }

  return now;
}

export const amazon: Provider = {
  name: PROVIDER_NAME,
  isAvailable() {
    return true;
  },

  async lookup(query: string, _type?: LookupType): Promise<ProviderResult<ParcelData>> {
    const start = Date.now();

    if (!this.isAvailable()) {
      return {
        provider: PROVIDER_NAME,
        success: false,
        data: {},
        error: 'Missing Amazon credentials',
        duration: Date.now() - start,
      };
    }

    // Determine orderId and trackingNumber.
    let orderNo = '';
    let trackingNumber = query;
    if (query.startsWith('http')) {
      try {
        const parsed = new URL(query);
        orderNo = parsed.searchParams.get('orderId') || '';
        trackingNumber = parsed.searchParams.get('shipmentId') || parsed.searchParams.get('trackingId') || '';
      } catch (e) {}
    } else if (query.includes('::')) {
      const parts = query.split('::');
      orderNo = parts[0];
      trackingNumber = parts[1];
    } else if (query.match(/^\d{3}-\d{7}-\d{6,7}$/)) {
      orderNo = query; // Query itself is an order number
    }

    let browser: Browser | null = null;
    let page: Page | null = null;

    try {
      const userDataDir = path.resolve(
        process.env.AMAZON_SESSION_DIR || path.join(process.cwd(), '.scratch', 'amazon-session'),
      );
      
      // Ensure directory exists
      if (!fs.existsSync(userDataDir)) {
         fs.mkdirSync(userDataDir, { recursive: true });
      }

      browser = await puppeteer.launch({
        userDataDir,
        headless: true,
        executablePath: resolvePuppeteerExecutablePath(),
        args: [
          '--disable-blink-features=AutomationControlled',
          '--no-sandbox',
          '--disable-setuid-sandbox',
        ],
        defaultViewport: { width: 1280, height: 800 },
      });

      if (!browser) throw new Error('Failed to launch browser');
      page = await browser.newPage();

      await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        Object.defineProperty(navigator, 'languages', {
          get: () => ['de-DE', 'de', 'en-US', 'en'],
        });
        delete (window as any).PublicKeyCredential;
        if (navigator.credentials) {
          navigator.credentials.get = () => Promise.reject(new Error('WebAuthn disabled'));
          navigator.credentials.create = () => Promise.reject(new Error('WebAuthn disabled'));
        }
      });

      await page.setExtraHTTPHeaders({
        'Accept-Language': 'de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7',
        'sec-ch-ua': '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Linux"',
      });

      const ensureEnglishUrl = (urlStr: string): string => {
        if (!urlStr) return urlStr;
        try {
          const parsed = new URL(urlStr);
          if (parsed.hostname.includes('amazon.')) {
            parsed.searchParams.set('language', 'en_GB');
            return parsed.toString();
          }
        } catch (_) {}
        return urlStr;
      };

      let trackingUrl = '';
      if (query.startsWith('http')) {
        trackingUrl = query;
      } else if (orderNo && trackingNumber !== orderNo) {
        trackingUrl = `https://www.amazon.de/progress-tracker/package?orderId=${orderNo}&packageIndex=0&shipmentId=${trackingNumber}&vt=NOTIFICATIONS`;
      } else if (orderNo) {
        trackingUrl = `https://www.amazon.de/gp/your-account/order-details?orderID=${orderNo}`;
      } else {
        throw new Error("Amazon provider requires an order number, orderId::trackingNumber format, or a full tracking URL.");
      }

      trackingUrl = ensureEnglishUrl(trackingUrl);

      await page.goto(trackingUrl, { waitUntil: 'load', timeout: 60000 });

      // Authentication
      const isSignIn =
        page.url().includes('/ap/signin') || (await page.$('input[name="email"]')) !== null;

      if (isSignIn) {
        const emailVal = config.amazonUsername;
        const passwordVal = config.amazonPassword;

        if (!emailVal || !passwordVal) {
          throw new Error('Amazon credentials missing.');
        }

        const emailInput = await page.$('input[name="email"]');
        if (emailInput) {
            await page.type('input[name="email"]', emailVal, { delay: 50 });
            await page.click('#continue');
            await new Promise((r) => setTimeout(r, 1500));
        }

        await page.keyboard.press('Escape');
        await new Promise((r) => setTimeout(r, 500));
        await page.keyboard.press('Escape');

        const fallbackClicked = await page.evaluate(() => {
          const anchors = Array.from(document.querySelectorAll('a, button'));
          const found = anchors.find(
            (a) =>
              a.id === 'auth-signin-with-password' ||
              a.id === 'passkey-signin-fallback' ||
              a.textContent?.toLowerCase().includes('stattdessen') ||
              a.textContent?.toLowerCase().includes('instead'),
          );
          if (found) {
            (found as HTMLElement).click();
            return true;
          }
          return false;
        });

        if (fallbackClicked) {
          await new Promise((r) => setTimeout(r, 1500));
        }

        await page.waitForSelector('input[name="password"]', { timeout: 10000 }).catch(() => {});

        const passwordInput = await page.$('input[name="password"]');
        if (passwordInput) {
            await page.type('input[name="password"]', passwordVal, { delay: 50 });
            await page.click('input#signInSubmit');
            await page.waitForNavigation({ waitUntil: 'load', timeout: 20000 }).catch(() => {});
            await new Promise((r) => setTimeout(r, 2000));
        }

        if (
          page.url().includes('approval') ||
          page.url().includes('cvf') ||
          page.url().includes('mfa')
        ) {
          if (config.amazonTotpKey) {
            const otpCode = generateTOTP(config.amazonTotpKey);
            let filled = false;

            if (await page.$('input#auth-mfa-otpcode')) {
              await page.type('input#auth-mfa-otpcode', otpCode);
              await page.click('input#auth-signin-button');
              filled = true;
            } else if (await page.$('input#ap_cvf_otpcode_input')) {
              await page.type('input#ap_cvf_otpcode_input', otpCode);
              await page.click('input#ap_cvf_submit');
              filled = true;
            } else if (await page.$("input[name='code']")) {
              await page.type("input[name='code']", otpCode);
              const submit = await page.$("input[type='submit'], button[type='submit']");
              if (submit) await submit.click();
              filled = true;
            }

            if (filled) {
              await page.waitForNavigation({ waitUntil: 'load', timeout: 30000 }).catch(() => {});
            }
          } else {
             throw new Error('2FA encountered but AMAZON_TOTP_KEY is missing.');
          }
        }

        await page.goto(trackingUrl, { waitUntil: 'load', timeout: 60000 });
      }

      if (page.url().includes('/ap/signin')) {
        throw new Error('Authentication failed. Redirected back to login.');
      }

      // If we are on order details, find tracking link
      let itemName: string | null = null;

      if (page.url().includes('order-details')) {
        itemName = await page.evaluate(() => {
          const itemLinks = Array.from(
            document.querySelectorAll(".yohtmlc-item a, .a-list-item a.a-link-normal, [class*='item-title'] a")
          );
          for (const link of itemLinks) {
            const text = link.textContent?.trim();
            if (text && text.length > 3) return text;
          }
          return null;
        });

        const trackingLinkHref = await page.evaluate(() => {
          const links = Array.from(document.querySelectorAll('a'));
          const trackLink = links.find(
            (a) =>
              a.href.includes('progress-tracker') ||
              a.href.includes('ship-track') ||
              a.textContent?.toLowerCase().includes('verfolgen') ||
              a.textContent?.toLowerCase().includes('track'),
          );
          return trackLink ? trackLink.href : null;
        });

        if (trackingLinkHref) {
          trackingUrl = ensureEnglishUrl(trackingLinkHref);
          await page.goto(trackingUrl, { waitUntil: 'load', timeout: 60000 });
        }
      }

      const showAllUpdatesSelectors = "a:has-text('Aktualisierungen'), a:has-text('updates'), a:has-text('Updates')";
      const showAllUpdates = await page.$(showAllUpdatesSelectors).catch(() => null);
      if (showAllUpdates) {
          await showAllUpdates.click().catch(() => {});
          await new Promise((r) => setTimeout(r, 3000));
      } else {
         await page.evaluate(() => {
				const elements = Array.from(document.querySelectorAll("a, button, span, div"));
				const target = elements.find(el => {
					const txt = el.textContent?.toLowerCase() || "";
					return txt.includes("aktualisierungen anzeigen") ||
						   txt.includes("see all updates") ||
						   txt.includes("show all updates");
				});
				if (target) {
					(target as HTMLElement).click();
				}
			});
            await new Promise((r) => setTimeout(r, 3000));
      }

      await page
        .waitForSelector('#primaryStatus, .primary-status, .track-package-status-box', {
          timeout: 10000,
        })
        .catch(() => {});

      const scrapedData = await page.evaluate(() => {
        const eventsList: Array<{ date: string; status: string; location?: string }> = [];

        const trackingEventsContainer = document.querySelector('#tracking-events-container');
        if (trackingEventsContainer) {
          const dayElements = Array.from(trackingEventsContainer.querySelectorAll('.a-row')).filter(
            (el) => el.querySelector('.tracking-event-date'),
          );
          for (const dayEl of dayElements) {
            const dateEl = dayEl.querySelector('.tracking-event-date');
            if (!dateEl) continue;
            const dateText = dateEl.textContent?.trim() || '';

            const rows = dayEl.querySelectorAll(
              '.a-row.a-spacing-large, .a-row.a-spacing-top-medium',
            );
            for (const row of Array.from(rows)) {
              const timeEl = row.querySelector('.tracking-event-time');
              const descEl = row.querySelector('.tracking-event-message');
              const locEl = row.querySelector('.tracking-event-location');

              if (descEl && descEl.textContent?.trim()) {
                const timeText = timeEl && timeEl.textContent?.trim() ? ` ${timeEl.textContent.trim()}` : '';
                eventsList.push({
                  date: `${dateText}${timeText}`,
                  status: descEl.textContent.trim(),
                  location: locEl ? locEl.textContent.trim() : undefined,
                });
              }
            }
          }
        }

        if (eventsList.length === 0) {
            const dayGroups = document.querySelectorAll(".a-spacing-double-large, .a-spacing-large, .tracking-event-group");
            for (const group of Array.from(dayGroups)) {
                const dateHeader = group.querySelector("h4, .a-size-medium, .event-date, .tracking-event-date");
                if (!dateHeader) continue;
                const dateText = dateHeader.textContent?.trim() || "";
                
                const eventRows = group.querySelectorAll(".a-row, .event-details");
                for (const row of Array.from(eventRows)) {
                    const timeEl = row.querySelector(".a-size-small, .event-time, .tracking-event-time");
                    const descEl = row.querySelector(".a-size-base, .event-description, .tracking-event-message, b, strong");
                    const locEl = row.querySelector(".a-color-secondary, .event-location, .tracking-event-location, span[class*='secondary']");
                    
                    if (descEl && descEl.textContent?.trim()) {
                        const timeText = timeEl ? ` ${timeEl.textContent.trim()}` : "";
                        eventsList.push({
                            date: `${dateText}${timeText}`,
                            status: descEl.textContent.trim(),
                            location: locEl ? locEl.textContent.trim() : undefined
                        });
                    }
                }
            }
        }

        let statusSlug = 'sent';
        const timelineHeader =
          document.querySelector('h1, h2, .a-size-large, .tracking-object-state')?.textContent?.trim()?.toLowerCase() ||
          '';
        if (
          timelineHeader.includes('zugestellt') ||
          timelineHeader.includes('delivered') ||
          timelineHeader.includes('geliefert')
        ) {
          statusSlug = 'delivered';
        } else if (
          timelineHeader.includes('heute') ||
          timelineHeader.includes('today') ||
          timelineHeader.includes('zustellung') ||
          timelineHeader.includes('delivery')
        ) {
          statusSlug = 'arriving';
        } else if (timelineHeader.includes('bestellt') || timelineHeader.includes('ordered')) {
          statusSlug = 'ordered';
        }

        let realTrackingId = '';
        const pageText = document.body.textContent || '';
        const trkMatch = pageText.match(
          /(?:Tracking\s*(?:ID|nummer|number)?|Sendungsnummer|Tracking-ID|Carrier\s*Tracking)\s*[:#-]?\s*([a-zA-Z0-9_-]{5,30})/i,
        );
        if (trkMatch && trkMatch[1]) {
          const rawId = trkMatch[1].trim();
          const rawIdClean = rawId.replace(/(?:Alle|Updates|Show|See|Details|Aktualisierungen).*$/i, '');
          const dhlMatch = rawIdClean.match(/(DE\d{10})/i);
          if (dhlMatch) {
            realTrackingId = dhlMatch[1].toUpperCase();
          } else {
            const cleanMatch = rawIdClean.match(/^([A-Z0-9_-]{5,25})/);
            realTrackingId = cleanMatch ? cleanMatch[1] : rawIdClean;
          }
        }

        return {
          events: eventsList,
          status: statusSlug,
          statusDescription: timelineHeader || 'In transit',
          realTrackingId: realTrackingId || undefined,
        };
      });

      const formattedEvents = scrapedData.events.map((ev) => {
        const dateObj = parseGermanDate(ev.date);
        return {
          date: dateObj.toISOString(),
          status: ev.status,
          location: ev.location,
          source: PROVIDER_NAME,
        };
      });

      if (!itemName) {
        itemName = await page.evaluate(() => {
            const productLinks = Array.from(document.querySelectorAll("a[href*='/gp/product/'], a[href*='/dp/']"));
            for (const link of productLinks) {
                const text = link.textContent?.trim();
                if (text && text.length > 5 && !text.toLowerCase().includes("details") && !text.toLowerCase().includes("review") && !text.toLowerCase().includes("feedback")) {
                    return text;
                }
            }
            return null;
        }).catch(() => null);
        if (itemName) itemName = itemName.replace(/<[^>]*>/g, "").trim();
      }

      await browser?.close();

      const statusCode = scrapedData.status === 'delivered' ? 40 : scrapedData.status === 'arriving' ? 30 : 10;
      const scrapedTrackingNumber = scrapedData.realTrackingId || trackingNumber;

      const data: ParcelData = {
        tracking_number: scrapedTrackingNumber,
        couriers: [PROVIDER_NAME],
        status: scrapedData.statusDescription,
        status_code: statusCode,
        status_description: scrapedData.statusDescription,
        delivered: statusCode === 40,
        events: formattedEvents,
        itemName: itemName || undefined,
      };

      return {
        provider: PROVIDER_NAME,
        success: true,
        data,
        duration: Date.now() - start,
      };
    } catch (err) {
      if (browser) await browser.close().catch(() => {});
      return {
        provider: PROVIDER_NAME,
        success: false,
        data: {},
        error: err instanceof Error ? err.message : String(err),
        duration: Date.now() - start,
      };
    }
  },
};
