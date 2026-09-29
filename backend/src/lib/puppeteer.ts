import { existsSync } from 'node:fs';
import puppeteer, { type Browser } from 'puppeteer';
import { config } from '../config.js';
import { type ProcHandle, procEnd, procStart } from './proc-log.js';

/** Common system Chromium paths (Docker / Unraid). */
const CHROMIUM_CANDIDATES = [
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome-stable',
];

let browser: Browser | null = null;
let resolvedExecutablePath: string | undefined;
let idleTimer: ReturnType<typeof setTimeout> | undefined;
/** Lifecycle record for the browser currently running, for the spawn log. */
let browserProc: ProcHandle | undefined;
/** Pages served by the current browser, reported when it closes. */
let pagesThisBrowser = 0;

/**
 * Shut the browser down once nothing has used it for a while.
 *
 * The singleton used to live for the lifetime of the process. In a memory-capped
 * container that meant a headless Chromium sitting there indefinitely after one
 * scrape — observed burning a steady half core and ~110 MB for an hour after the
 * request that started it had long finished.
 */
function scheduleIdleClose(): void {
  if (idleTimer) clearTimeout(idleTimer);
  if (config.puppeteerIdleTimeout <= 0) return;
  idleTimer = setTimeout(() => {
    void closeBrowser('idle-timeout');
  }, config.puppeteerIdleTimeout);
  // Must not be the reason the process stays alive.
  idleTimer.unref?.();
}

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

/**
 * Close the shared browser, if one was ever launched.
 *
 * `reason` is recorded in the spawn log, because which reason fired is the
 * diagnostic: "idle-timeout" means the timer did its job, "shutdown" means the
 * process is going away, and a fresh spawn with no close in between means
 * something is holding the browser open.
 */
export async function closeBrowser(reason = 'explicit'): Promise<void> {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = undefined;
  }
  if (!browser) return;
  const b = browser;
  browser = null;
  const proc = browserProc;
  browserProc = undefined;
  const pages = pagesThisBrowser;
  pagesThisBrowser = 0;
  try {
    await b.close();
    if (proc) procEnd(proc, reason, { pages });
  } catch (error) {
    // Already gone; nothing to release. Still worth recording, since a browser
    // that died on its own is a different story from one we closed.
    if (proc) {
      procEnd(proc, `${reason} (close failed: ${error instanceof Error ? error.message : error})`, {
        pages,
      });
    }
  }
}

export async function getBrowser(): Promise<Browser> {
  if (browser?.connected) {
    scheduleIdleClose();
    return browser;
  }

  // Non-null but disconnected means it went away without us closing it — a
  // crash or an OOM kill. Close the record out so the next spawn is not
  // mistaken for the same browser still running.
  if (browser && browserProc) {
    procEnd(browserProc, 'died (disconnected)', { pages: pagesThisBrowser });
    browserProc = undefined;
    pagesThisBrowser = 0;
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
  browserProc = procStart('browser', executablePath, {
    pid: browser.process()?.pid,
    idleTimeout: `${config.puppeteerIdleTimeout}ms`,
  });
  pagesThisBrowser = 0;

  scheduleIdleClose();
  return browser;
}

/** Fetch a page with headless Chromium. */
export async function scrapeWithBrowser(url: string, waitSelector?: string): Promise<string> {
  const b = await getBrowser();
  const page = await b.newPage();
  pagesThisBrowser++;
  // One line per page is what exposes fan-out: a cold /api/status/all opens one
  // page per configured status service, which is easy to miss from timings alone.
  const proc = procStart('page', url);
  let outcome = 'ok';
  try {
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    );
    await page.goto(url, { waitUntil: 'networkidle2', timeout: config.puppeteerTimeout });

    if (waitSelector) {
      await page.waitForSelector(waitSelector, { timeout: 5000 }).catch(() => {});
    }

    return await page.content();
  } catch (error) {
    outcome = `error: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`;
    throw error;
  } finally {
    await page.close().catch(() => {});
    procEnd(proc, outcome);
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
