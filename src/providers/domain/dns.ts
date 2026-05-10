import { promises as dns } from 'node:dns';
import { isIP } from 'node:net';
import type { LookupType, Provider, ProviderResult } from '../../types/common.js';

const PROVIDER_NAME = 'dns';

/**
 * DNS lookup provider.
 * Uses Node.js built-in dns module for A, AAAA, MX, TXT, NS, CNAME, SOA, PTR records.
 */
export const dnsProvider: Provider = {
  name: PROVIDER_NAME,

  isAvailable() {
    return true; // Always available
  },

  async lookup(query: string, _type?: LookupType): Promise<ProviderResult> {
    const start = Date.now();

    try {
      const data: Record<string, unknown> = {};
      const raw: Record<string, unknown> = {};

      // If it's an IP address, do reverse DNS
      if (isIP(query)) {
        try {
          const hostnames = await dns.reverse(query);
          data.reverse_dns = hostnames;
          raw.reverse = hostnames;
        } catch (_e) {
          // No reverse DNS available
        }
        return {
          provider: PROVIDER_NAME,
          success: true,
          data,
          raw,
          duration: Date.now() - start,
        };
      }

      // Domain lookups — run all in parallel
      const _results = await Promise.allSettled([
        dns.resolve4(query).then((r) => {
          raw.A = r;
          data.dns_a = r;
        }),
        dns.resolve6(query).then((r) => {
          raw.AAAA = r;
          data.dns_aaaa = r;
        }),
        dns.resolveMx(query).then((r) => {
          raw.MX = r;
          data.dns_mx = r
            .sort((a, b) => a.priority - b.priority)
            .map((m) => `${m.priority} ${m.exchange}`);
        }),
        dns.resolveTxt(query).then((r) => {
          raw.TXT = r;
          data.dns_txt = r.map((t) => t.join(''));
        }),
        dns.resolveNs(query).then((r) => {
          raw.NS = r;
          data.dns_ns = r;
        }),
        dns
          .resolveCname(query)
          .then((r) => {
            raw.CNAME = r;
            data.dns_cname = r;
          })
          .catch(() => {}),
        dns.resolveSoa(query).then((r) => {
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

      const hasData = Object.keys(data).length > 0;

      return {
        provider: PROVIDER_NAME,
        success: hasData,
        data,
        raw,
        error: hasData ? undefined : 'No DNS records found',
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
