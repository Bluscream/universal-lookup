import { existsSync } from 'node:fs';
import puppeteer, { type Browser } from 'puppeteer';
import { config } from '../config.js';
import { cloudscraperGet } from './cloudscraper-fetch.js';

/** Common system Chromium paths (Docker / Unraid). */
const CHROMIUM_CANDIDATES = [
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome-stable',
];

let browser: Browser | null = null;
let resolvedExecutablePath: string | undefined;

/**
 * Resolve Chromium binary. Unraid templates often set PUPPETEER_EXECUTABLE_PATH=""
 * which overrides the image ENV; auto-detect when unset or empty.
 */
export function resolvePuppeteerExecutablePath(): string | undefined {
  if (resolvedExecutablePath !== undefined) {
    return resolvedExecutablePath || undefined;
  }

  const fromEnv = config.puppeteerExecutablePath.trim();
  if (fromEnv) {
    resolvedExecutablePath = fromEnv;
    return fromEnv;
  }

  for (const candidate of CHROMIUM_CANDIDATES) {
    if (existsSync(candidate)) {
      resolvedExecutablePath = candidate;
      return candidate;
    }
  }

  resolvedExecutablePath = '';
  return undefined;
}

export async function getBrowser(): Promise<Browser> {
  if (browser?.connected) {
    return browser;
  }

  const executablePath = resolvePuppeteerExecutablePath();
  if (!executablePath) {
    throw new Error(
      'Chromium not found. Set PUPPETEER_EXECUTABLE_PATH (e.g. /usr/bin/chromium) or install system Chromium.',
    );
  }

  const defaultArgs = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-accelerated-2d-canvas',
    '--no-first-run',
    '--no-zygote',
    '--single-process', // <- this one is important for memory in docker
    '--disable-gpu',
  ];

  if (config.puppeteerArgs) {
    // Parse arguments, supporting quoted strings
    const customArgs = config.puppeteerArgs.match(/[^"\s]+|"(?:\\"|[^"])+"/g) || [];
    for (const arg of customArgs) {
      const cleanArg = arg.replace(/^"|"$/g, '');
      if (cleanArg) {
        defaultArgs.push(cleanArg);
      }
    }
  }

  browser = await puppeteer.launch({
    headless: true,
    executablePath,
    args: defaultArgs,
  });

  return browser;
}

/**
 * Fetch a page with headless Chromium, skipping the cloudscraper attempt.
 *
 * Worth calling directly for hosts behind a Cloudflare *managed* challenge:
 * cloudscraper can't solve those (it just returns the "Just a moment..." 403),
 * so trying it first only costs a round trip.
 */
export async function scrapeWithBrowser(url: string, waitSelector?: string): Promise<string> {
  const b = await getBrowser();
  const page = await b.newPage();
  try {
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    );
    await page.goto(url, { waitUntil: 'networkidle2', timeout: config.puppeteerTimeout });

    if (waitSelector) {
      await page.waitForSelector(waitSelector, { timeout: 5000 }).catch(() => {});
    }

    return await page.content();
  } finally {
    await page.close();
  }
}

export async function scrapeWithPuppeteer(url: string, waitSelector?: string): Promise<string> {
  // 1. Try cloudscraper first
  try {
    const html = await cloudscraperGet({
      url,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });

    if (html && html.trim().length > 0) {
      // Basic sanity check to make sure we didn't get an empty page or a Cloudflare blocker page
      const lowerHtml = html.toLowerCase();
      if (
        !lowerHtml.includes('cf-challenge') &&
        !lowerHtml.includes('attention required!') &&
        !lowerHtml.includes('cloudflare') &&
        !lowerHtml.includes('ddg-captcha')
      ) {
        return html;
      }
    }
  } catch (err) {
    console.warn(
      `[Cloudscraper] Failed to fetch ${url}, falling back to Puppeteer:`,
      err instanceof Error ? err.message : err,
    );
  }

  // 2. Fallback to Puppeteer
  return scrapeWithBrowser(url, waitSelector);
}
