import { promises as dns } from 'node:dns';
import { isIP } from 'node:net';
import axios from 'axios';
import { config } from '../../config.js';
import type { LookupType, Provider, ProviderResult } from '../../types/common.js';

const PROVIDER_NAME = 'subdomain';

/** Common subdomains to check via DNS */
const COMMON_SUBDOMAINS = [
  'www',
  'mail',
  'ftp',
  'smtp',
  'pop',
  'imap',
  'webmail',
  'ns1',
  'ns2',
  'dns',
  'mx',
  'api',
  'dev',
  'staging',
  'test',
  'admin',
  'portal',
  'vpn',
  'remote',
  'cdn',
  'static',
  'assets',
  'blog',
  'shop',
  'store',
  'app',
  'mobile',
  'm',
  'docs',
];

export const subdomainProvider: Provider = {
  name: PROVIDER_NAME,
  isAvailable() {
    return true;
  },

  async lookup(query: string, _type?: LookupType): Promise<ProviderResult> {
    const start = Date.now();
    try {
      if (isIP(query)) {
        return {
          provider: PROVIDER_NAME,
          success: false,
          data: {},
          error: 'Subdomain enumeration requires a domain, not an IP',
          duration: Date.now() - start,
        };
      }
      const domain = query.replace(/^www\./, '');
      const [crtResults, dnsResults] = await Promise.allSettled([
        searchCrtSh(domain),
        bruteforceSubdomains(domain),
      ]);
      const found = new Set<string>();
      if (crtResults.status === 'fulfilled') {
        crtResults.value.forEach((s) => {
          found.add(s);
        });
      }
      if (dnsResults.status === 'fulfilled') {
        dnsResults.value.forEach((s) => {
          found.add(s);
        });
      }
      const sorted = [...found].sort().slice(0, config.universalResultsLimit);
      return {
        provider: PROVIDER_NAME,
        success: sorted.length > 0,
        data: { subdomains: sorted },
        raw: {
          crt_sh: crtResults.status === 'fulfilled' ? crtResults.value : [],
          dns_brute: dnsResults.status === 'fulfilled' ? dnsResults.value : [],
        },
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

async function searchCrtSh(domain: string): Promise<string[]> {
  const resp = await axios.get(`https://crt.sh/?q=%25.${encodeURIComponent(domain)}&output=json`, {
    timeout: config.providerTimeout,
  });
  const subs = new Set<string>();
  for (const entry of resp.data) {
    const name = (entry.name_value || '').toLowerCase();
    for (const n of name.split('\n')) {
      const clean = n.trim().replace(/^\*\./, '');
      if (clean.endsWith(domain) && clean !== domain) subs.add(clean);
    }
  }
  return [...subs];
}

async function bruteforceSubdomains(domain: string): Promise<string[]> {
  const found: string[] = [];
  const checks = COMMON_SUBDOMAINS.map(async (sub) => {
    const fqdn = `${sub}.${domain}`;
    try {
      await dns.resolve4(fqdn);
      found.push(fqdn);
    } catch {
      /* not found */
    }
  });
  await Promise.allSettled(checks);
  return found;
}
