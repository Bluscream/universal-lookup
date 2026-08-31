import axios from 'axios';
import { config } from '../../config.js';
import type { LookupType, Provider, ProviderResult, UrlData } from '../../types/common.js';

const PROVIDER_NAME = 'semonto';
const SEMONTO_API_BASE = 'https://api.semonto.com/2';

interface SemontoServer {
  id: number;
  name: string;
  location: string;
}

interface SemontoCreateResponse {
  success: boolean;
  data: {
    public_id: string;
    servers: SemontoServer[];
  };
  time?: number;
  server?: string;
}

interface SemontoStatusResponse {
  success: boolean;
  data?: {
    public_id: string;
    result?: {
      status: string;
      finished?: number;
      result?: {
        tool_reachability?: {
          status: number;
          time?: string;
          http?: string;
          ip_address?: string;
          time_formatted?: string;
          ssl?: {
            status: number;
            time?: string;
            valid?: boolean;
            cert?: {
              days?: string;
              cert_subject?: string;
              cert_issuer?: string;
              cert_not_before?: string;
              cert_not_after?: string;
            };
          };
          error?: string;
        };
      };
    };
  };
}

/**
 * Semonto reachability provider.
 * Runs multi-region global reachability checks via Semonto's public API.
 */
export const semontoProvider: Provider = {
  name: PROVIDER_NAME,

  isAvailable() {
    return true; // Public free tool endpoint, no API key required
  },

  async lookup(query: string, _type?: LookupType): Promise<ProviderResult<UrlData>> {
    const start = Date.now();

    try {
      let targetUrl = query.trim();
      if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
        targetUrl = `https://${targetUrl}`;
      }

      // 1. Create reachability check job
      const createResp = await axios.post<SemontoCreateResponse>(
        `${SEMONTO_API_BASE}/publictools/create/`,
        new URLSearchParams({
          url: targetUrl,
          type: 'reachability',
        }),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': config.statusUserAgent,
          },
          timeout: Math.min(8000, config.serverTimeout),
        },
      );

      if (!createResp.data?.success || !createResp.data?.data?.public_id) {
        throw new Error('Failed to initialize Semonto reachability check');
      }

      const { public_id, servers = [] } = createResp.data.data;

      // 2. Poll servers for status (poll up to 3 times with short sleep)
      // Pick a sample of key representative regional servers or all returned
      const checkServers = servers.slice(0, 5);
      const results: Record<string, unknown>[] = [];

      for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt > 0) {
          await new Promise((resolve) => setTimeout(resolve, 1500));
        }

        const promises = checkServers.map(async (server) => {
          try {
            const statusResp = await axios.post<SemontoStatusResponse>(
              `${SEMONTO_API_BASE}/publictools/status/`,
              new URLSearchParams({
                public_id,
                server_id: String(server.id),
              }),
              {
                headers: {
                  'Content-Type': 'application/x-www-form-urlencoded',
                  'User-Agent': config.statusUserAgent,
                },
                timeout: 5000,
              },
            );

            const toolResult = statusResp.data?.data?.result?.result?.tool_reachability;
            if (toolResult) {
              return {
                server_id: server.id,
                location: server.location,
                http_status: toolResult.http ? parseInt(toolResult.http, 10) : null,
                response_time: toolResult.time_formatted || null,
                ip_address: toolResult.ip_address || null,
                ssl_valid: toolResult.ssl?.valid ?? null,
                cert_days_remaining: toolResult.ssl?.cert?.days ? parseFloat(toolResult.ssl.cert.days) : null,
                error: toolResult.error || null,
              };
            }
          } catch {
            return null;
          }
          return null;
        });

        const batch = (await Promise.all(promises)).filter(Boolean) as Record<string, unknown>[];
        if (batch.length > 0) {
          results.push(...batch);
          break;
        }
      }

      const successfulCheck = results.find((r) => r.http_status);

      const data: UrlData = {
        query,
        target_url: targetUrl,
        semonto_public_id: public_id,
        semonto_report: `https://semonto.com/tools/website-reachability-check?test=${public_id}`,
        regional_checks: results,
        http_status: (successfulCheck?.http_status as number) ?? null,
        server_ip: (successfulCheck?.ip_address as string) ?? null,
        ssl_valid: (successfulCheck?.ssl_valid as boolean) ?? null,
      };

      return {
        provider: PROVIDER_NAME,
        success: results.length > 0,
        data,
        raw: {
          public_id,
          servers,
          results,
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
