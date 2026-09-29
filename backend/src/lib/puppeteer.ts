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

/**
 * Launch a browser that is *not* the shared singleton, with the same spawn
 * logging the singleton gets.
 *
 * The Amazon and AliExpress providers cannot share the singleton: they need a
 * persistent `userDataDir` to stay logged in, and anti-automation launch flags
 * the shared browser does not carry. That is legitimate, but it meant three
 * more browsers nothing recorded. Exit is taken from the browser's own
 * `disconnected` event, so every close path is covered without each caller
 * having to report one.
 */
export async function launchDedicatedBrowser(
  label: string,
  options: Parameters<typeof puppeteer.launch>[0],
): Promise<Browser> {
  const b = await puppeteer.launch(options);
  const proc = procStart('browser', label, { pid: b.process()?.pid, dedicated: true });
  b.once('disconnected', () => procEnd(proc, 'disconnected'));
  return b;
}

/**
 * Settle `promise` within `ms`, or reject with `label`.
 *
 * Puppeteer's own `timeout` options are not a budget you can rely on: a
 * `goto` configured for 15 s was observed surfacing its timeout at 59 s,
 * because the single-process renderer cannot service the rejection while it is
 * still busy. This wraps a hard ceiling around the whole operation.
 */
function withDeadline<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(label)), ms);
    timer.unref?.();
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer)) as Promise<T>;
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
    // A hard ceiling over the whole navigation, not just puppeteer's own
    // timeout — see withDeadline.
    return await withDeadline(
      (async () => {
        await page.setUserAgent(
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        );
        // Not networkidle2: it waits for the network to go quiet, which never
        // happens on a page carrying ads, analytics or polling. Every
        // allestörungen fetch timed out on it while the payload we want was
        // already in the document. domcontentloaded is what this scraper needs;
        // anything rendered later is covered by waitSelector.
        await page.goto(url, {
          waitUntil: config.puppeteerWaitUntil,
          timeout: config.puppeteerTimeout,
        });

        if (waitSelector) {
          await page.waitForSelector(waitSelector, { timeout: 5000 }).catch(() => {});
        }

        return await page.content();
      })(),
      config.puppeteerTimeout + 5000,
      `Scrape exceeded hard deadline of ${config.puppeteerTimeout + 5000}ms`,
    );
  } catch (error) {
    outcome = `error: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`;
    throw error;
  } finally {
    // Closing can hang for as long as the navigation did, so it gets its own
    // budget. A page that will not close would otherwise accumulate against the
    // container's memory cap, so the whole browser goes instead — bounded and
    // cheap, since the next call just launches a fresh one.
    const closed = await withDeadline(page.close(), 3000, 'page close timed out').then(
      () => true,
      () => false,
    );
    procEnd(proc, outcome, closed ? undefined : { close: 'timed-out' });
    if (!closed) await closeBrowser('page-close-timeout');
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
