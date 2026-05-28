import { promises as dns } from 'node:dns';
import type { LookupType, Provider, ProviderResult, UrlData } from '../../types/common.js';

const PROVIDER_NAME = 'dns-lookup';

/**
 * dns-lookup — Resolves DNS records for a URL's hostname.
 */
export const dnsLookupProvider: Provider = {
  name: PROVIDER_NAME,

  isAvailable() {
    return true; // Always available
  },

  async lookup(query: string, _type?: LookupType): Promise<ProviderResult<UrlData>> {
    const start = Date.now();

    try {
      const urlObj = new URL(query);
      const hostname = urlObj.hostname;

      const data: UrlData = { hostname };
      const raw: Record<string, unknown> = {};

      const _results = await Promise.allSettled([
        dns.resolve4(hostname).then((r) => {
          raw.A = r;
          data.dns_a = r;
        }),
        dns.resolve6(hostname).then((r) => {
          raw.AAAA = r;
          data.dns_aaaa = r;
        }),
        dns.resolveMx(hostname).then((r) => {
          raw.MX = r;
          data.dns_mx = r
            .sort((a, b) => a.priority - b.priority)
            .map((m) => `${m.priority} ${m.exchange}`);
        }),
        dns.resolveTxt(hostname).then((r) => {
          raw.TXT = r;
          data.dns_txt = r.map((t) => t.join(''));
        }),
        dns.resolveNs(hostname).then((r) => {
          raw.NS = r;
          data.dns_ns = r;
        }),
        dns
          .resolveCname(hostname)
          .then((r) => {
            raw.CNAME = r;
            data.dns_cname = r;
          })
          .catch(() => {}),
        dns.resolveSoa(hostname).then((r) => {
          raw.SOA = r;
          data.dns_soa = {
            primary_ns: r.nsname,
            admin_email: r.hostmaster,
            serial: r.serial,
            refresh: r.refresh,
            retry: r.retry,
            expire: r.expire,
            min_ttl: r.minttl,
          };
        }),
      ]);

      const hasData = Object.keys(data).length > 1; // more than just 'hostname'

      return {
        provider: PROVIDER_NAME,
        success: hasData,
        data,
        raw,
        error: hasData ? undefined : 'No DNS records found for hostname',
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
