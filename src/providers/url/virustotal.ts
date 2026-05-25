import axios from 'axios';
import { config } from '../../config.js';
import type { LookupType, Provider, ProviderResult } from '../../types/common.js';

const PROVIDER_NAME = 'virustotal';

/**
 * virustotal — Queries VirusTotal v3 domain report API.
 * Docs: https://docs.virustotal.com/reference/domain-info
 */
export const virustotalProvider: Provider = {
  name: PROVIDER_NAME,

  isAvailable() {
    return !!config.virustotalApiKey;
  },

  async lookup(query: string, _type?: LookupType): Promise<ProviderResult> {
    const start = Date.now();

    try {
      const urlObj = new URL(query);
      const hostname = urlObj.hostname;

      const url = `https://www.virustotal.com/api/v3/domains/${encodeURIComponent(hostname)}`;
      const response = await axios.get(url, {
        headers: {
          'x-apikey': config.virustotalApiKey,
        },
        timeout: config.serverTimeout,
      });

      const raw = response.data;
      const attributes = raw.data?.attributes;

      if (!attributes) {
        return {
          provider: PROVIDER_NAME,
          success: false,
          data: {},
          raw,
          error: 'No attributes found in VirusTotal response',
          duration: Date.now() - start,
        };
      }

      const stats = attributes.last_analysis_stats || {};
      const totalVotes = (Object.values(stats) as number[]).reduce((a, b) => a + b, 0);
      const maliciousVotes = (stats.malicious as number) ?? 0;
      const suspiciousVotes = stats.suspicious ?? 0;

      const data: Record<string, unknown> = {
        registrar: attributes.registrar || null,
        creation_date: attributes.creation_date
          ? new Date(attributes.creation_date * 1000).toISOString()
          : null,
        reputation: attributes.reputation ?? 0,
        malicious_votes: maliciousVotes,
        suspicious_votes: suspiciousVotes,
        total_votes: totalVotes,
        is_suspicious: maliciousVotes > 0 || suspiciousVotes > 0,
        categories: attributes.categories || {},
        last_dns_records: attributes.last_dns_records || [],
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
