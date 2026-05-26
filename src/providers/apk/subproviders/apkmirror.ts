import * as cheerio from 'cheerio';
import type { ApkDownloadInfo } from './aptoide.js';

export async function getApkmirrorDownload(pkg: string): Promise<ApkDownloadInfo[]> {
  try {
    const url = `https://www.apkmirror.com/?post_type=app_release&searchtype=apk&s=${pkg}`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36',
      },
    });
    
    if (!res.ok) return [];
    
    const html = await res.text();
    const $ = cheerio.load(html);
    
    const downloads: ApkDownloadInfo[] = [];

    $('.appRow').each((_, el) => {
      const titleEl = $(el).find('.appRowTitle a');
      const href = titleEl.attr('href');
      const title = titleEl.text().trim();
      
      // Look for download link
      const downloadIcon = $(el).find('.downloadIcon');
      const downloadHref = downloadIcon.attr('href');
      
      if (href && downloadHref) {
        // Extract version from title if possible (e.g. "App Name 1.2.3")
        const versionMatch = title.match(/[\d.]+/);
        const version = versionMatch ? versionMatch[0] : undefined;

        downloads.push({
          source: 'APKMirror',
          version,
          url: downloadHref.startsWith('http') ? downloadHref : `https://www.apkmirror.com${downloadHref}`,
        });
      }
    });

    return downloads;
  } catch (err) {
    console.error(`[APK] APKMirror error for ${pkg}:`, err);
    return [];
  }
}
