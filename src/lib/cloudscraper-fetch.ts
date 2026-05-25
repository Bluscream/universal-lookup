import cloudscraper from 'cloudscraper';
import type { CloudscraperGetOptions } from 'cloudscraper';
import { config } from '../config.js';

/** Fetch HTML via cloudscraper (Cloudflare bypass). */
export function cloudscraperGet(options: CloudscraperGetOptions): Promise<string> {
  return new Promise((resolve, reject) => {
    cloudscraper.get(
      {
        ...options,
        timeout: options.timeout ?? config.serverTimeout,
      },
      (error, response, body) => {
        if (error) {
          reject(error);
        } else if (response.statusCode >= 400) {
          reject(new Error(`HTTP Status ${response.statusCode}`));
        } else {
          resolve(body);
        }
      },
    );
  });
}
