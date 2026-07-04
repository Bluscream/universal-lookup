import axios from 'axios';
import { config } from '../../config.js';
import type { LookupType, Provider, ProviderResult, StatusData } from '../../types/common.js';
import { statusGet } from './http.js';
import { type StatuspageSummary, summaryToStatusData } from './statuspage.js';

const PROVIDER_NAME = 'battlenet';
const PAGE_URL = 'https://support.blizzard.com/';
const OAUTH_URL = 'https://oauth.battle.net/token';

/**
 * Battle.net / Blizzard has no public status feed. Two modes:
 *
 *  - Detailed (BLIZZARD_CLIENT_ID + BLIZZARD_CLIENT_SECRET set): OAuth
 *    client-credentials → sample a few WoW connected-realms via the game-data API
 *    (status.type UP/DOWN + has_queue). This is WoW-realm health, used as a proxy
 *    for Blizzard service health.
 *  - Approximate (no credentials): probe the Battle.net OAuth endpoint and infer
 *    status from reachability + latency. A response (even 401) means the auth
 *    service is up; a timeout/connection error means it's down.
 */

// ---- pure converters (unit-tested) -----------------------------------------

export interface RealmStatus {
  name: string;
  up: boolean;
  hasQueue: boolean;
}

/** Detailed mode: aggregate sampled WoW realms into a canonical summary. */
export function realmsToSummary(realms: RealmStatus[], region: string): StatuspageSummary {
  const down = realms.filter((r) => !r.up);
  const queued = realms.filter((r) => r.up && r.hasQueue);
  const indicator = down.length > 0 ? 'major' : queued.length > 0 ? 'minor' : 'none';

  return {
    page: { name: 'Battle.net', url: PAGE_URL, updated_at: null },
    status: {
      indicator,
      description:
        indicator === 'none'
          ? `WoW ${region.toUpperCase()} realms operational (${realms.length} sampled)`
          : `${down.length} realm(s) down, ${queued.length} with login queue`,
    },
    incidents: [
      ...down.map((r) => ({
        name: `${r.name}: Down`,
        impact: 'major',
        status: 'identified',
        shortlink: PAGE_URL,
      })),
      ...queued.map((r) => ({
        name: `${r.name}: Login queue`,
        impact: 'minor',
        status: 'monitoring',
        shortlink: PAGE_URL,
      })),
    ],
  };
}

/** Approximate mode: infer status from reachability + latency of the auth endpoint. */
export function reachabilityToSummary(
  reachable: boolean,
  ms: number,
  slowMs: number,
): StatuspageSummary {
  let indicator: string;
  let description: string;
  if (!reachable) {
    indicator = 'major';
    description = 'Battle.net auth endpoint unreachable';
  } else if (ms > slowMs) {
    indicator = 'minor';
    description = `Battle.net auth endpoint responding slowly (${ms}ms)`;
  } else {
    indicator = 'none';
    description = `Battle.net auth endpoint reachable (${ms}ms, approximate)`;
  }
  return {
    page: { name: 'Battle.net', url: PAGE_URL, updated_at: null },
    status: { indicator, description },
    incidents: [],
  };
}

// ---- data fetching ----------------------------------------------------------

interface ConnectedRealm {
  has_queue?: boolean;
  status?: { type?: string };
  realms?: Array<{ name?: string | { en_US?: string } }>;
}

function realmName(cr: ConnectedRealm): string {
  const n = cr.realms?.[0]?.name;
  if (typeof n === 'string') return n;
  if (n && typeof n === 'object') return n.en_US || 'Realm';
  return 'Realm';
}

async function fetchToken(): Promise<string> {
  const resp = await axios.post(OAUTH_URL, 'grant_type=client_credentials', {
    timeout: config.serverTimeout,
    auth: { username: config.blizzardClientId, password: config.blizzardClientSecret },
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  const token = (resp.data as { access_token?: string })?.access_token;
  if (!token) throw new Error('No access_token from Battle.net OAuth');
  return token;
}

async function detailedSummary(): Promise<{ summary: StatuspageSummary; raw: unknown }> {
  const region = config.statusBlizzardRegion;
  const token = await fetchToken();
  const auth = { Authorization: `Bearer ${token}` };

  const indexUrl = `https://${region}.api.blizzard.com/data/wow/connected-realm/index?namespace=dynamic-${region}&locale=en_US`;
  const indexResp = await statusGet<{ connected_realms?: Array<{ href?: string }> }>(indexUrl, {
    headers: auth,
  });
  const hrefs = (indexResp.data?.connected_realms || [])
    .map((c) => c.href)
    .filter((h): h is string => !!h)
    .slice(0, Math.max(1, config.statusBlizzardRealmSample));

  const realms: RealmStatus[] = [];
  for (const href of hrefs) {
    try {
      const sep = href.includes('?') ? '&' : '?';
      const r = await statusGet<ConnectedRealm>(`${href}${sep}locale=en_US`, { headers: auth });
      realms.push({
        name: realmName(r.data),
        up: (r.data.status?.type || '').toUpperCase() === 'UP',
        hasQueue: !!r.data.has_queue,
      });
    } catch {
      // skip individual realm failures
    }
  }

  if (realms.length === 0) throw new Error('No connected realms could be read');
  return { summary: realmsToSummary(realms, region), raw: { region, realms } };
}

async function approximateSummary(): Promise<{ summary: StatuspageSummary; raw: unknown }> {
  const slowMs = config.statusBlizzardSlowMs;
  const start = Date.now();
  let reachable = false;
  let code: number | string = 'error';
  try {
    // No credentials → 401 is the expected "up" response; any HTTP reply = reachable.
    const resp = await axios.post(OAUTH_URL, 'grant_type=client_credentials', {
      timeout: config.serverTimeout,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      validateStatus: () => true,
    });
    reachable = true;
    code = resp.status;
  } catch (e) {
    reachable = false;
    code = (e as { code?: string })?.code || 'error';
  }
  const ms = Date.now() - start;
  return { summary: reachabilityToSummary(reachable, ms, slowMs), raw: { reachable, ms, code, approximate: true } };
}

export const blizzardProvider: Provider = {
  name: PROVIDER_NAME,

  isAvailable() {
    return true; // always available (falls back to reachability probe)
  },

  async lookup(_query: string, _type?: LookupType): Promise<ProviderResult<StatusData>> {
    const start = Date.now();
    const hasCreds = !!config.blizzardClientId && !!config.blizzardClientSecret;
    try {
      const { summary, raw } = hasCreds ? await detailedSummary() : await approximateSummary();
      return {
        provider: PROVIDER_NAME,
        success: true,
        data: summaryToStatusData(summary, PROVIDER_NAME, 'Battle.net'),
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
