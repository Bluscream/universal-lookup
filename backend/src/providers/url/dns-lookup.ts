import { promises as dns } from 'node:dns';
import { config } from '../../config.js';
import type { LookupType, Provider, ProviderResult, UrlData } from '../../types/common.js';

const PROVIDER_NAME = 'dns-lookup';

/**
 * Bound one DNS query.
 *
 * `Promise.allSettled` waits for every entry, so a single record type that
 * never answers held the whole lookup open — there was no timeout anywhere in
 * this provider, and a resolver that blackholes one query type (common for
 * AAAA or SOA behind a restrictive network) could hang the request past any
 * caller's patience. Each query now fails on its own, and the rest still land.
 */
function limit<T>(promise: Promise<T>, record: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${record} query timed out after ${config.dnsTimeout}ms`)),
      config.dnsTimeout,
    );
    timer.unref?.();
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer)) as Promise<T>;
}

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
        limit(dns.resolve4(hostname), 'A').then((r) => {
          raw.A = r;
          data.dns_a = r;
        }),
        limit(dns.resolve6(hostname), 'AAAA').then((r) => {
          raw.AAAA = r;
          data.dns_aaaa = r;
        }),
        limit(dns.resolveMx(hostname), 'MX').then((r) => {
          raw.MX = r;
          data.dns_mx = r
            .sort((a, b) => a.priority - b.priority)
            .map((m) => `${m.priority} ${m.exchange}`);
        }),
        limit(dns.resolveTxt(hostname), 'TXT').then((r) => {
          raw.TXT = r;
          data.dns_txt = r.map((t) => t.join(''));
        }),
        limit(dns.resolveNs(hostname), 'NS').then((r) => {
          raw.NS = r;
          data.dns_ns = r;
        }),
        limit(dns.resolveCname(hostname), 'CNAME')
          .then((r) => {
            raw.CNAME = r;
            data.dns_cname = r;
          })
          .catch(() => {}),
        limit(dns.resolveSoa(hostname), 'SOA').then((r) => {
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
