import type { LookupType, Provider, ProviderResult, StatusData } from '../../types/common.js';
import { statusGet } from './http.js';
import { type StatuspageSummary, summaryToStatusData } from './statuspage.js';

const PROVIDER_NAME = 'azure';
const PAGE_URL = 'https://status.azure.com/en-us/status';

/**
 * Azure has no Statuspage; its status page is backed by an RSS feed. Each
 * `<item>` is an active issue/advisory. No items = operational.
 */
const AZURE_URL = 'https://azurestatuscdn.azureedge.net/en-us/status/feed/';

function decodeXml(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Convert the Azure RSS feed into a canonical StatuspageSummary. */
export function azureToSummary(xml: string): StatuspageSummary {
  const items = [...(xml || '').matchAll(/<item>([\s\S]*?)<\/item>/gi)].map((m) => {
    const block = m[1];
    const title = block.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? 'Azure advisory';
    const date = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/i)?.[1];
    return { title: decodeXml(title), date: date?.trim() || null };
  });

  const indicator = items.length === 0 ? 'none' : 'minor';
  return {
    page: { name: 'Microsoft Azure', url: PAGE_URL, updated_at: null },
    status: {
      indicator,
      description:
        indicator === 'none'
          ? 'All Systems Operational'
          : `${items.length} active advisor${items.length === 1 ? 'y' : 'ies'}`,
    },
    incidents: items.map((i) => ({
      name: i.title,
      impact: 'minor',
      status: 'identified',
      shortlink: PAGE_URL,
      started_at: i.date,
    })),
  };
}

export const azureProvider: Provider = {
  name: PROVIDER_NAME,

  isAvailable() {
    return true;
  },

  async lookup(_query: string, _type?: LookupType): Promise<ProviderResult<StatusData>> {
    const start = Date.now();
    try {
      const resp = await statusGet<string>(AZURE_URL, { responseType: 'text' });
      const xml = typeof resp.data === 'string' ? resp.data : String(resp.data);
      const summary = azureToSummary(xml);
      return {
        provider: PROVIDER_NAME,
        success: true,
        data: summaryToStatusData(summary, PROVIDER_NAME, 'Microsoft Azure'),
        raw: summary,
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
