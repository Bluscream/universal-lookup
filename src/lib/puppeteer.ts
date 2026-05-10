import puppeteer, { type Browser } from 'puppeteer';
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
