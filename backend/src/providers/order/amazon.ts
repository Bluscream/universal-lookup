import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer, { type Browser, type Cookie, type CookieParam, type Page } from 'puppeteer';
import { config } from '../../config.js';
import { resolvePuppeteerExecutablePath } from '../../lib/puppeteer.js';
import type { LookupType, OrderData, Provider, ProviderResult } from '../../types/common.js';

const PROVIDER_NAME = 'amazon';

function cookiesFilePath(): string {
  return (
    config.amazonCookiesFile || path.resolve(path.dirname(config.dbPath), 'amazon-cookies.json')
  );
}

function loadCookies(): CookieParam[] | null {
  const p = cookiesFilePath();
  if (!fs.existsSync(p)) return null;
  try {
    const raw: Array<Record<string, unknown>> = JSON.parse(fs.readFileSync(p, 'utf-8'));
    return raw.map((c) => ({
      name: String(c.name),
      value: String(c.value),
      domain: String(c.domain || '.amazon.de'),
      path: String(c.path || '/'),
      expires: typeof c.expires === 'number' && c.expires > 0 ? c.expires : undefined,
      httpOnly: Boolean(c.httpOnly),
      secure: Boolean(c.secure),
      sameSite: (c.sameSite as CookieParam['sameSite']) || undefined,
    }));
  } catch {
    return null;
  }
}

function saveCookies(cookies: Cookie[]): void {
  const p = cookiesFilePath();
  try {
    const dir = path.dirname(p);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(p, JSON.stringify(cookies, null, 2), 'utf-8');
  } catch (e) {
    console.error('[Amazon] Failed to save cookies:', e);
  }
}

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

  const parsed = new Date(dateStr);
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
    return fs.existsSync(cookiesFilePath()) || !!(config.amazonUsername && config.amazonPassword);
  },

  async lookup(query: string, _type?: LookupType): Promise<ProviderResult<OrderData>> {
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

    const orderNo = query.trim();

    if (!orderNo || !orderNo.match(/^\d{3}-\d{7}-\d{6,7}$/)) {
      return {
        provider: PROVIDER_NAME,
        success: false,
        data: {},
        error: 'Invalid order number format. Expected XXX-XXXXXXX-XXXXXXX',
        duration: Date.now() - start,
      };
    }

    let browser: Browser | null = null;
    let page: Page | null = null;

    try {
      const userDataDir = path.resolve(
        process.env.AMAZON_SESSION_DIR || path.join(path.dirname(config.dbPath), 'amazon-session'),
      );

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
        delete (window as unknown as { PublicKeyCredential?: unknown }).PublicKeyCredential;
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

      const cookies = loadCookies();
      const hasCookies = cookies !== null && cookies.length > 0;
      if (hasCookies) {
        await page.setCookie(...cookies!);
      }

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

      let targetUrl = `https://www.amazon.de/gp/your-account/order-details?orderID=${orderNo}`;
      targetUrl = ensureEnglishUrl(targetUrl);

      await page.goto(targetUrl, { waitUntil: 'load', timeout: 60000 });

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

        await page.goto(targetUrl, { waitUntil: 'load', timeout: 60000 });

        if (!page.url().includes('/ap/signin')) {
          const newCookies = await page.cookies();
          saveCookies(newCookies);
        }
      }

      if (page.url().includes('/ap/signin')) {
        throw new Error('Authentication failed. Redirected back to login.');
      }

      // We should now be on the order details page
      const scrapedData = await page.evaluate(() => {
        const itemsList: Array<{ name: string; url?: string }> = [];

        const trackingIds: string[] = [];

        // Try to find the main order container to avoid scraping recommended items
        const orderContainer =
          document.querySelector('#orderDetails') ||
          document.querySelector('.a-box-group') ||
          document;

        // Check if order exists
        const errorMsg = document.querySelector('.a-alert-heading');
        if (errorMsg && errorMsg.textContent?.toLowerCase().includes('problem')) {
          const statusDescription = 'Order not found or access denied';
          return {
            itemsList,
            trackingIds,
            totalPrice: '',
            status: 'error',
            statusDescription,
            shippingAddress: '',
          };
        }

        const itemLinks = Array.from(
          orderContainer.querySelectorAll(
            '.yohtmlc-item a.a-link-normal, .a-box.shipment a.a-link-normal, .shipment-is-delivered a.a-link-normal, .shipment-is-active a.a-link-normal',
          ),
        );

        // Fallback to a broader search if the above fails, but avoid the "Recommendations" section
        const generalLinks =
          itemLinks.length > 0
            ? itemLinks
            : Array.from(orderContainer.querySelectorAll('a.a-link-normal'));

        if (generalLinks.length > 0) {
          for (const link of generalLinks) {
            const text = link.textContent?.trim();
            const href = (link as HTMLAnchorElement).href || '';
            // Avoid extracting links from the bottom carousel
            if (
              text &&
              text.length > 5 &&
              (href.includes('/gp/product/') || href.includes('/dp/')) &&
              !href.includes('buyagain')
            ) {
              // avoid duplicates
              if (!itemsList.find((i) => i.name === text)) {
                itemsList.push({ name: text, url: href });
              }
            }
          }
        }

        // Extract tracking IDs from progress-tracker links within the order container
        const trackLinksList: string[] = [];
        const trackLinks = Array.from(
          orderContainer.querySelectorAll("a[href*='progress-tracker'], a[href*='ship-track']"),
        );
        for (const link of trackLinks) {
          const href = (link as HTMLAnchorElement).href;
          if (href && !trackLinksList.includes(href)) {
            trackLinksList.push(href);
          }
          const parsed = new URL(href, window.location.origin);
          const shipmentId =
            parsed.searchParams.get('shipmentId') || parsed.searchParams.get('trackingId');
          if (shipmentId && !trackingIds.includes(shipmentId)) {
            trackingIds.push(shipmentId);
          }
        }

        // Extract Total Price
        let totalPrice = '';
        const priceElements = Array.from(
          document.querySelectorAll(".grand-total-price, [data-test='order-total']"),
        );
        for (const el of priceElements) {
          if (el.textContent) {
            totalPrice = el.textContent.trim();
            break;
          }
        }

        // Extract Status
        let status = 'unknown';
        let statusDescription = '';
        const statusEl = document.querySelector(
          ".js-shipment-info-container h1, .yohtmlc-order-status, .js-shipment-info-container h3, [class*='order-status']",
        );
        if (statusEl && statusEl.textContent) {
          statusDescription = statusEl.textContent.trim();
          const lower = statusDescription.toLowerCase();
          if (lower.includes('zugestellt') || lower.includes('delivered')) {
            status = 'delivered';
          } else if (
            lower.includes('heute') ||
            lower.includes('today') ||
            lower.includes('arriving')
          ) {
            status = 'arriving';
          } else if (lower.includes('versandt') || lower.includes('shipped')) {
            status = 'shipped';
          } else if (lower.includes('bestellt') || lower.includes('ordered')) {
            status = 'ordered';
          }
        }

        // Extract Shipping Address roughly
        let shippingAddress = '';
        const addressBlock = document.querySelector(
          ".displayAddressDiv, [class*='shipping-address']",
        );
        if (addressBlock && addressBlock.textContent) {
          shippingAddress = addressBlock.textContent.replace(/\\s+/g, ' ').trim();
        }

        return {
          itemsList,
          trackingIds,
          trackLinksList,
          totalPrice,
          status,
          statusDescription,
          shippingAddress,
        };
      });

      const shipments: Array<{
        tracking_url?: string;
        tracking_id?: string;
        item_id?: string;
        package_index?: string;
      }> = [];

      for (const trackUrl of scrapedData.trackLinksList || []) {
        try {
          const parsed = new URL(trackUrl, 'https://www.amazon.de');
          const shipmentId =
            parsed.searchParams.get('shipmentId') || parsed.searchParams.get('trackingId');
          const itemId = parsed.searchParams.get('itemId');
          const packageIndex = parsed.searchParams.get('packageIndex');

          shipments.push({
            tracking_url: trackUrl,
            tracking_id: shipmentId || undefined,
            item_id: itemId || undefined,
            package_index: packageIndex || undefined,
          });
        } catch (e) {
          console.error('Failed to parse tracking link:', e);
        }
      }

      await browser?.close();

      const data: OrderData = {
        order_id: orderNo,
        status: scrapedData.status,
        status_description: scrapedData.statusDescription,
        total_price: scrapedData.totalPrice || undefined,
        shipping_address: scrapedData.shippingAddress || undefined,
        items: scrapedData.itemsList,
        tracking_numbers: scrapedData.trackingIds.length > 0 ? scrapedData.trackingIds : undefined,
        shipments: shipments.length > 0 ? shipments : undefined,
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
