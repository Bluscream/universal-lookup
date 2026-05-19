import puppeteer, { type Browser } from 'puppeteer';
import { cloudscraperGet } from './cloudscraper-fetch.js';
import { config } from '../config.js';

let browser: Browser | null = null;

export async function getBrowser(): Promise<Browser> {
  if (browser?.connected) {
    return browser;
  }

  browser = await puppeteer.launch({
    headless: true,
    executablePath: config.puppeteerExecutablePath || undefined,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--single-process', // <- this one is important for memory in docker
      '--disable-gpu',
    ],
  });

  return browser;
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

    const content = await page.content();
    return content;
  } finally {
    await page.close();
  }
}
