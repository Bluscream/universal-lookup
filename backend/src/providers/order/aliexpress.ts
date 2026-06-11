import puppeteer, { type Browser, type Page, type CookieParam } from 'puppeteer';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { config } from '../../config.js';
import { resolvePuppeteerExecutablePath } from '../../lib/puppeteer.js';
import type { LookupType, OrderData, Provider, ProviderResult } from '../../types/common.js';

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

const PROVIDER_NAME = 'aliexpress';

/** AliExpress order ID: 16 numeric digits */
const ORDER_ID_RE = /^\d{16}$/;

// ─── Cookie helpers ───────────────────────────────────────────────────────────

/**
 * Resolve the cookies JSON file path.
 * Priority: ALIEXPRESS_COOKIES_FILE env → ./data/aliexpress-cookies.json
 */
function cookiesFilePath(): string {
  return config.aliexpressCookiesFile || path.resolve(path.dirname(config.dbPath), 'aliexpress-cookies.json');
}

/** Load cookies from the JSON file and convert to Puppeteer format */
function loadCookies(): CookieParam[] | null {
  const p = cookiesFilePath();
  if (!fs.existsSync(p)) return null;
  const raw: Record<string, unknown>[] = JSON.parse(fs.readFileSync(p, 'utf-8'));
  return raw.map(c => ({
    name: String(c.name),
    value: String(c.value),
    domain: String(c.domain || '.aliexpress.com'),
    path: String(c.path || '/'),
    expires: typeof c.expires === 'number' && c.expires > 0 ? c.expires : undefined,
    httpOnly: Boolean(c.httpOnly),
    secure: Boolean(c.secure),
    sameSite: (c.sameSite as CookieParam['sameSite']) || undefined,
  }));
}

// ─── Browser helpers ──────────────────────────────────────────────────────────

async function launchBrowser(userDataDir?: string): Promise<Browser> {
  const executablePath = resolvePuppeteerExecutablePath();
  return puppeteer.launch({
    headless: true,
    executablePath,
    userDataDir,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ],
    defaultViewport: { width: 1280, height: 800 },
  });
}

async function patchPage(page: Page): Promise<void> {
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'languages', { get: () => ['de-DE', 'de', 'en-US', 'en'] });
  });
}

async function isLoginPage(page: Page): Promise<boolean> {
  const url = page.url();
  return (
    url.includes('ug-login-page') ||
    url.includes('/login') ||
    (await page.$('.cosmos-input')) !== null
  );
}

// ─── Login flow (fallback when no valid cookies) ──────────────────────────────

/**
 * Perform AliExpress email+password login.
 * AliExpress uses a custom `.cosmos-input` for the email step.
 */
async function doLogin(page: Page, username: string, password: string): Promise<void> {
  // Dismiss cookie consent
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(b =>
      b.textContent?.toLowerCase().includes('accept') ||
      b.textContent?.toLowerCase().includes('akzeptieren')
    );
    if (btn) btn.click();
  }).catch(() => {});
  await new Promise(r => setTimeout(r, 800));

  // Email input (cosmos design system)
  const emailInput = await page.$('.cosmos-input');
  if (!emailInput) throw new Error('AliExpress login: email input (.cosmos-input) not found');
  await emailInput.click({ clickCount: 3 });
  await emailInput.type(username, { delay: 60 });
  await page.keyboard.press('Enter');
  await new Promise(r => setTimeout(r, 2000));

  // Password input
  const pwInput = await page.$('input[type="password"]');
  if (!pwInput) throw new Error('AliExpress login: password input not found after email submit');
  await page.type('input[type="password"]', password, { delay: 60 });
  await page.keyboard.press('Enter');

  await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 25000 }).catch(() => {});
  await new Promise(r => setTimeout(r, 2000));

  // Check for 2FA/verification code screen
  const otpSelector = 'input[name="code"], input[id*="code"], input[id*="otp"], input.verification-code, input#code';
  const hasOtpInput = await page.evaluate((sel) => !!document.querySelector(sel), otpSelector);
  
  if (hasOtpInput) {
    if (config.aliexpressTotpKey) {
      const otpCode = generateTOTP(config.aliexpressTotpKey);
      const otpInput = await page.$(otpSelector);
      if (otpInput) {
        await otpInput.type(otpCode, { delay: 60 });
        await page.keyboard.press('Enter');
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 25000 }).catch(() => {});
        await new Promise(r => setTimeout(r, 2000));
      }
    } else {
      console.warn('[AliExpress] 2FA screen encountered but ALIEXPRESS_TOTP_KEY is missing');
    }
  }
}

// ─── Page scrapers ────────────────────────────────────────────────────────────

async function scrapeOrderDetail(page: Page, orderId: string): Promise<{
  status: string;
  statusDescription: string;
  totalPrice: string;
  items: Array<{ name: string; url?: string }>;
  trackOrderUrl?: string;
}> {
  const detailUrl = `https://www.aliexpress.com/p/order/detail.html?orderId=${orderId}`;
  await page.goto(detailUrl, { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise(r => setTimeout(r, 2000));

  return page.evaluate(() => {
    const items: Array<{ name: string; url?: string }> = [];

    // Only scrape items from the order-specific container, not recommendations
    const orderContainer =
      document.querySelector('[class*="order-detail"], [class*="orderDetail"], main') ||
      document;

    for (const link of Array.from(orderContainer.querySelectorAll<HTMLAnchorElement>('a[href*="/item/"]'))) {
      const name = link.textContent?.trim();
      // Skip recommendation links (they have verbose price/rating text appended)
      const href = link.href;
      if (
        name && name.length > 3 && name.length < 200 &&
        !name.match(/[€$]\d|\d+\+\s*verkauft|Rabatt|sparen|Kostenlos/i) &&
        !href.includes('gps-id=pcOrderDetail') &&
        !items.find(i => i.name === name)
      ) {
        items.push({ name, url: href });
      }
    }

    // Status heading — look in main content area first, skip sidebar nav headings
    const SIDEBAR_LABELS = new Set(['account', 'orders', 'overview', 'payment', 'feedback',
      'settings', 'messages', 'returns', 'konto', 'bestellungen', 'übersicht']);
    let status = 'unknown';
    let statusDescription = '';
    const mainEl = document.querySelector('main, [class*="order-detail"], [class*="orderDetail"]') || document;
    for (const h of Array.from(mainEl.querySelectorAll('h1, h2, h3, h4'))) {
      const text = h.textContent?.trim() || '';
      if (text.length > 2 && text.length < 100 && !SIDEBAR_LABELS.has(text.toLowerCase())) {
        statusDescription = text;
        const l = text.toLowerCase();
        if (l.includes('delivered') || l.includes('zugestellt')) status = 'delivered';
        else if (l.includes('awaiting delivery') || l.includes('wartet auf lieferung') ||
                 l.includes('in transit') || l.includes('unterwegs')) status = 'in_transit';
        else if (l.includes('shipped') || l.includes('versandt') || l.includes('dispatched')) status = 'shipped';
        else if (l.includes('processing') || l.includes('paid') || l.includes('bezahlt') ||
                 l.includes('wird bearbeitet')) status = 'processing';
        break;
      }
    }


    let totalPrice = '';
    const priceEl = document.querySelector('[class*="order-price"], [class*="total-price"]');
    if (priceEl) totalPrice = priceEl.textContent?.trim() || '';

    const trackLink = document.querySelector<HTMLAnchorElement>(
      'a[href*="tracking/index.html"], a[href*="tradeOrderId"]'
    );

    return { status, statusDescription, totalPrice, items, trackOrderUrl: trackLink?.href };
  });
}

async function scrapeTrackingPage(page: Page, orderId: string): Promise<{
  carrier?: string;
  trackingNumber?: string;
  trackingEvents: Array<{ description: string }>;
}> {
  const trackingUrl =
    `https://www.aliexpress.com/p/tracking/index.html` +
    `?_addShare=no&_login=yes&tradeOrderId=${orderId}`;

  await page.goto(trackingUrl, { waitUntil: 'networkidle0', timeout: 60000 });

  // Wait for the SPA to render the tracking details
  await page.waitForFunction(
    () => (document.body.innerText || '').includes('Tracking number'),
    { timeout: 20000 }
  ).catch(() => {});
  await new Promise(r => setTimeout(r, 2000));

  return page.evaluate(() => {
    const text = document.body.innerText || '';

    let carrier: string | undefined;
    const carrierMatch = text.match(
      /(?:AliExpress[^:\n]*Standard|Carrier|Courier)[:\s]+([A-Za-z][A-Za-z\s]{1,30}?)(?:\n|Tracking|Paket)/i
    );
    if (carrierMatch) carrier = carrierMatch[1].trim();

    // Match both English and German tracking number labels
    let trackingNumber: string | undefined;
    const tnMatch = text.match(/(?:Tracking number|Paketverfolgungsnummer|Trackingnummer)[:\s]+([A-Z0-9]{8,35})/i);
    if (tnMatch) trackingNumber = tnMatch[1].trim();

    const events: Array<{ description: string }> = [];
    for (const el of Array.from(
      document.querySelectorAll('[class*="event"], [class*="track-item"], [class*="logistic"]')
    ).slice(0, 10)) {
      const desc = el.textContent?.trim();
      if (desc && desc.length > 3 && desc.length < 300) events.push({ description: desc });
    }

    return { carrier, trackingNumber, trackingEvents: events };
  });
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export const aliexpress: Provider = {
  name: PROVIDER_NAME,

  isAvailable(): boolean {
    // Available if we have a cookies file OR login credentials
    return fs.existsSync(cookiesFilePath()) ||
      !!(config.aliexpressUsername && config.aliexpressPassword);
  },

  async lookup(query: string, _type?: LookupType): Promise<ProviderResult<OrderData>> {
    const start = Date.now();

    const orderId = query.trim();
    if (!ORDER_ID_RE.test(orderId)) {
      return {
        provider: PROVIDER_NAME,
        success: false,
        data: {},
        error: 'Invalid AliExpress order ID format. Expected 16 digits.',
        duration: Date.now() - start,
      };
    }

    const cookies = loadCookies();
    const hasCookies = cookies !== null && cookies.length > 0;
    const hasCredentials = !!(config.aliexpressUsername && config.aliexpressPassword);

    if (!hasCookies && !hasCredentials) {
      return {
        provider: PROVIDER_NAME,
        success: false,
        data: {},
        error:
          'No AliExpress session available. ' +
          'Provide ALIEXPRESS_COOKIES_FILE (exported browser cookies) ' +
          'or ALIEXPRESS_USERNAME + ALIEXPRESS_PASSWORD.',
        duration: Date.now() - start,
      };
    }

    let browser: Browser | null = null;

    try {
      // ── Launch: use session dir when falling back to login so cookies persist
      const sessionDir = hasCookies
        ? undefined
        : path.resolve(path.dirname(config.dbPath), 'aliexpress-session');

      if (!hasCookies && sessionDir && !fs.existsSync(sessionDir)) {
        fs.mkdirSync(sessionDir, { recursive: true });
      }

      browser = await launchBrowser(sessionDir);
      const page = await browser.newPage();
      await patchPage(page);

      // ── Inject cookies if available ─────────────────────────────────────────
      if (hasCookies) {
        await page.setCookie(...cookies!);
      }

      // ── Navigate to order detail ────────────────────────────────────────────
      const detailUrl = `https://www.aliexpress.com/p/order/detail.html?orderId=${orderId}`;
      await page.goto(detailUrl, { waitUntil: 'networkidle2', timeout: 60000 });
      await new Promise(r => setTimeout(r, 1500));

      // ── Login if needed (either cookies expired or no cookies) ──────────────
      if (await isLoginPage(page)) {
        if (!hasCredentials) {
          throw new Error(
            'AliExpress session cookies are expired or invalid. ' +
            'Re-export cookies from your browser to ' + cookiesFilePath()
          );
        }
        await doLogin(page, config.aliexpressUsername!, config.aliexpressPassword!);
        // Navigate back to order detail after login
        await page.goto(detailUrl, { waitUntil: 'networkidle2', timeout: 60000 });
        await new Promise(r => setTimeout(r, 2000));

        if (await isLoginPage(page)) {
          throw new Error(
            'AliExpress authentication failed (slider CAPTCHA or wrong credentials). ' +
            'Export fresh browser cookies to ' + cookiesFilePath()
          );
        }
      }

      // ── Scrape ──────────────────────────────────────────────────────────────
      const orderDetail = await scrapeOrderDetail(page, orderId);
      const tracking = await scrapeTrackingPage(page, orderId);

      await browser.close();

      // ── Build result ────────────────────────────────────────────────────────
      const trackingNumbers = tracking.trackingNumber ? [tracking.trackingNumber] : undefined;
      const shipments = tracking.trackingNumber
        ? [{ tracking_id: tracking.trackingNumber, carrier: tracking.carrier, tracking_url: orderDetail.trackOrderUrl }]
        : undefined;

      const data: OrderData = {
        order_id: orderId,
        status: orderDetail.status,
        status_description: orderDetail.statusDescription || undefined,
        total_price: orderDetail.totalPrice || undefined,
        items: orderDetail.items.length > 0 ? orderDetail.items : undefined,
        tracking_numbers: trackingNumbers,
        shipments,
        carrier: tracking.carrier,
        tracking_events: tracking.trackingEvents.length > 0 ? tracking.trackingEvents : undefined,
      };

      return { provider: PROVIDER_NAME, success: true, data, duration: Date.now() - start };
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
