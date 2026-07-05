import type { LookupType, Provider, ProviderResult, StatusData } from '../../types/common.js';
import { statusGet } from './http.js';
import { type StatuspageSummary, summaryToStatusData } from './statuspage.js';

const PROVIDER_NAME = 'aws';
const PAGE_URL = 'https://health.aws.amazon.com/health/status';

/**
 * AWS has no Statuspage. Its Health Dashboard publishes "current events" as a
 * UTF-16LE-encoded JSON array (with a BOM). Entries represent current service
 * events; a `status` of "0" means informational/normal, higher values indicate
 * degradation/disruption. Empty array (or only status-0 entries) = operational.
 */
const AWS_URL = 'https://health.aws.amazon.com/public/currentevents';

interface AwsEvent {
  service_name?: string;
  region_name?: string;
  summary?: string;
  status?: string;
}

/** Decode the UTF-16LE (BOM-prefixed) AWS payload into events. */
export function parseAwsEvents(buf: Buffer): AwsEvent[] {
  const isUtf16 = buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe;
  const text = (isUtf16 ? buf.toString('utf16le') : buf.toString('utf8')).replace(/^﻿/, '');
  try {
    const data = JSON.parse(text);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

/** Convert AWS current events into a canonical StatuspageSummary. */
export function awsToSummary(events: AwsEvent[]): StatuspageSummary {
  // status "0" = informational/normal; anything else is a real disruption.
  const active = (events || []).filter((e) => (e.status ?? '0') !== '0');
  const anyMajor = active.some((e) => Number(e.status) >= 3);
  const indicator = active.length === 0 ? 'none' : anyMajor ? 'major' : 'minor';

  return {
    page: { name: 'Amazon Web Services', url: PAGE_URL, updated_at: null },
    status: {
      indicator,
      description:
        indicator === 'none'
          ? 'All Systems Operational'
          : `${active.length} active event${active.length === 1 ? '' : 's'}`,
    },
    incidents: active.map((e) => ({
      name: `${e.service_name || 'AWS'}${e.region_name ? ` (${e.region_name})` : ''}: ${e.summary || 'Service event'}`,
      impact: Number(e.status) >= 3 ? 'major' : 'minor',
      status: 'identified',
      shortlink: PAGE_URL,
    })),
  };
}

export const awsProvider: Provider = {
  name: PROVIDER_NAME,

  isAvailable() {
    return true;
  },

  async lookup(_query: string, _type?: LookupType): Promise<ProviderResult<StatusData>> {
    const start = Date.now();
    try {
      const resp = await statusGet<ArrayBuffer>(AWS_URL, { responseType: 'arraybuffer' });
      const events = parseAwsEvents(Buffer.from(resp.data as ArrayBuffer));
      const summary = awsToSummary(events);
      return {
        provider: PROVIDER_NAME,
        success: true,
        data: summaryToStatusData(summary, PROVIDER_NAME, 'Amazon Web Services'),
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
