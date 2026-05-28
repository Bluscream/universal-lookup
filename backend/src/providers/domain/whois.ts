import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const whoisLib = require('whois');

import { config } from '../../config.js';
import type { DomainData, LookupType, Provider, ProviderResult } from '../../types/common.js';

const PROVIDER_NAME = 'whois';

/**
 * WHOIS lookup provider.
 * Uses the 'whois' npm package for Port 43 WHOIS queries.
 */
export const whois: Provider = {
  name: PROVIDER_NAME,

  isAvailable() {
    return true; // Always available
  },

  async lookup(query: string, _type?: LookupType): Promise<ProviderResult<DomainData>> {
    const start = Date.now();

    try {
      const raw = await new Promise<string>((resolve, reject) => {
        whoisLib.lookup(
          query,
          { timeout: config.serverTimeout },
          (err: Error | null, data: string) => {
            if (err) reject(err);
            else resolve(data);
          },
        );
      });

      // Parse the raw WHOIS text into key-value pairs
      const data = parseWhoisData(raw);

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

/**
 * Parse raw WHOIS text response into structured key-value pairs.
 */
function parseWhoisData(raw: string): Record<string, unknown> {
  const data: DomainData = {};
  const lines = raw.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('%') || trimmed.startsWith('#') || trimmed.startsWith('>')) {
      continue;
    }

    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) continue;

    const key = trimmed.slice(0, colonIdx).trim().toLowerCase();
    const value = trimmed.slice(colonIdx + 1).trim();
    if (!value) continue;

    // Map common WHOIS fields to normalized names
    switch (key) {
      case 'netname':
      case 'network-name':
        data.whois_netname = value;
        break;
      case 'orgname':
      case 'org-name':
      case 'organization':
        data.whois_org = value;
        break;
      case 'country':
        data.whois_country = value;
        break;
      case 'registrant':
        data.whois_registrant = value;
        break;
      case 'registrar':
        data.whois_registrar = value;
        break;
      case 'creation date':
      case 'created':
      case 'created date':
        data.whois_created = value;
        break;
      case 'registry expiry date':
      case 'expiry date':
      case 'expires':
        data.whois_expires = value;
        break;
      case 'updated date':
      case 'last modified':
      case 'changed':
        data.whois_updated = value;
        break;
      case 'domain name':
        data.whois_domain = value;
        break;
      case 'name server':
      case 'nserver':
        if (!data.whois_nameservers) data.whois_nameservers = [];
        (data.whois_nameservers as string[]).push(value);
        break;
      case 'cidr':
        data.whois_cidr = value;
        break;
      case 'descr':
      case 'description':
        if (!data.whois_description) data.whois_description = value;
        break;
      case 'abuse-mailbox':
      case 'abuse-c':
        data.whois_abuse_contact = value;
        break;
    }
  }

  return data;
}
