import { existsSync } from 'node:fs';
import puppeteer, { type Browser } from 'puppeteer';
import { config } from '../config.js';

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
  if (fromEnv && existsSync(fromEnv)) {
    resolvedExecutablePath = fromEnv;
    return fromEnv;
  }
  if (fromEnv) {
    // Taking the configured path on faith produces "Browser was not found at the
    // configured executablePath" at first use, long after the setting was made.
    console.warn(
      `⚠️  PUPPETEER_EXECUTABLE_PATH is set to ${fromEnv}, which does not exist — falling back to auto-detection`,
    );
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

/** Close the shared browser, if one was ever launched. */
export async function closeBrowser(): Promise<void> {
  if (!browser) return;
  const b = browser;
  browser = null;
  try {
    await b.close();
  } catch {
    // Already gone; nothing to release.
  }
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

/** Fetch a page with headless Chromium. */
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
  // Previously this tried cloudscraper first and fell back to a real browser.
  // cloudscraper is unmaintained and answers 403 on exactly the Cloudflare
  // challenges it existed to clear, so the fast path only ever added a failed
  // request — and it dragged in `request`, which carries an unfixable SSRF
  // advisory. The browser is the path that actually works.
  return scrapeWithBrowser(url, waitSelector);
}
