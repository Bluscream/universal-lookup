import axios from 'axios';
import { config } from '../../config.js';
import type { LookupType, Provider, ProviderResult } from '../../types/common.js';

const PROVIDER_NAME = 'urlscan';

/**
 * urlscan — Queries urlscan.io for historical scan results of a domain.
 * Docs: https://docs.urlscan.io/
 */
export const urlscanProvider: Provider = {
  name: PROVIDER_NAME,

  isAvailable() {
    return !!config.urlscanApiKey;
  },

  async lookup(query: string, _type?: LookupType): Promise<ProviderResult> {
    const start = Date.now();

    try {
      const urlObj = new URL(query);
      const hostname = urlObj.hostname;

      const url = `https://urlscan.io/api/v1/search/?q=domain:${encodeURIComponent(hostname)}&size=3`;
      const response = await axios.get(url, {
        headers: {
          'API-Key': config.urlscanApiKey,
          'User-Agent': 'Universal-Lookup/1.0 (https://github.com/Bluscream/universal-lookup)',
        },
        timeout: config.providerTimeout,
      });

      const raw = response.data;
      const results = raw.results || [];

      if (results.length === 0) {
        return {
          provider: PROVIDER_NAME,
          success: false,
          data: {},
          raw,
          error: 'No historical scans found for domain',
          duration: Date.now() - start,
        };
      }

      // Extract general summaries from the latest scan
      const latest = results[0];
      const task = latest.task || {};
      const page = latest.page || {};
      const stats = latest.stats || {};
      const verdict = latest.verdicts?.overall || {};

      const data: Record<string, unknown> = {
        last_scan_id: task.uuid,
        last_scan_time: task.time,
        scan_url: task.url,
        country: page.country,
        server: page.server,
        ip: page.ip,
        requests_count: stats.uniqIPs ?? 0,
        screenshot: latest.screenshot ? `https://urlscan.io/screenshots/${task.uuid}.png` : null,
        malicious: verdict.malicious ?? false,
        score: verdict.score ?? 0,
        categories: verdict.categories ?? [],
        urlscan_report: `https://urlscan.io/result/${task.uuid}/`,
      };

      return {
        provider: PROVIDER_NAME,
        success: true,
        data,
        raw,
        duration: Date.now() - start,
      };
    } catch (error) {
      return {
        provider: PROVIDER_NAME,
        success: false,
        data: {},
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - start,
      };
    }
  },
};
