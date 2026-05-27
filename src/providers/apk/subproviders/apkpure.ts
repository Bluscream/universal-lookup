import * as cheerio from 'cheerio';
import type { ApkDownloadInfo } from './aptoide.js';

export async function getApkpureDownload(pkg: string): Promise<ApkDownloadInfo[]> {
  try {
    // 1. Search for the app to get the exact APKPure page URL
    const searchUrl = `https://m.apkpure.com/search?q=${pkg}`;
    const searchRes = await fetch(searchUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Linux; Android 10; SM-G981B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/80.0.3987.162 Mobile Safari/537.36',
      },
    });

    if (!searchRes.ok) return [];

    const searchHtml = await searchRes.text();
    const $search = cheerio.load(searchHtml);

    // Find the first search result that matches the package
    let appUrl = '';
    $search('a').each((_, el) => {
      const href = $search(el).attr('href');
      if (href?.includes(pkg) && !href.includes('/download/')) {
        appUrl = href.startsWith('http') ? href : `https://m.apkpure.com${href}`;
        return false; // Break loop
      }
      return true; // Continue
    });

    if (!appUrl) return [];

    // 2. Load the app page
    const appRes = await fetch(appUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Linux; Android 10; SM-G981B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/80.0.3987.162 Mobile Safari/537.36',
      },
    });

    if (!appRes.ok) return [];
    const appHtml = await appRes.text();
    const $app = cheerio.load(appHtml);

    const downloads: ApkDownloadInfo[] = [];

    // Look for download buttons
    $app('a.download-btn, a.da').each((_, el) => {
      let href = $app(el).attr('href');
      if (href) {
        if (!href.startsWith('http')) {
          href = `https://m.apkpure.com${href}`;
        }

        // Sometimes the version is in the title or text
        const text = $app(el).text().trim();
        const versionMatch = text.match(/V(\d[\d.]+)/i);
        const version = versionMatch ? versionMatch[1] : undefined;

        downloads.push({
          source: 'APKPure',
          url: href,
          version,
        });
      }
    });

    return downloads;
  } catch (err) {
    console.error(`[APK] APKPure error for ${pkg}:`, err);
    return [];
  }
}
