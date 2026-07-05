import { config } from '../../config.js';
import {
  type DualPromiseResult,
  executeProvidersBackground,
  filterAndSortProviders,
} from '../../lib/providers.js';
import type { LookupType, Provider } from '../../types/common.js';
import { activisionProvider } from './activision.js';
import { awsProvider } from './aws.js';
import { azureProvider } from './azure.js';
import { blizzardProvider } from './blizzard.js';
import { gcpProvider } from './gcp.js';
import { INSTATUS_SERVICES, makeInstatusProvider } from './instatus.js';
import { nintendoProvider } from './nintendo.js';
import { playstationProvider } from './playstation.js';
import { steamProvider } from './steam.js';
import { makeStatuspageProvider, STATUSPAGE_SERVICES } from './statuspage.js';
import { ubisoftProvider } from './ubisoft.js';
import { xboxProvider } from './xbox.js';

/** Words that mean "give me everything" rather than a specific service filter. */
const ALL_KEYWORDS = new Set(['', 'all', 'status', 'services', 'everything', 'any', '*']);

/**
 * All service-health/uptime providers.
 * Generic Statuspage-backed services plus custom adapters for platforms that
 * don't expose a Statuspage feed (Xbox = XML, PlayStation = region JSON,
 * Activision/Steam/Ubisoft = bespoke APIs, EA = Instatus).
 */
const ALL_STATUS_PROVIDERS: Provider[] = [
  ...STATUSPAGE_SERVICES.map(makeStatuspageProvider),
  ...INSTATUS_SERVICES.map(makeInstatusProvider),
  xboxProvider,
  playstationProvider,
  activisionProvider,
  steamProvider,
  ubisoftProvider,
  blizzardProvider,
  nintendoProvider,
  gcpProvider,
  awsProvider,
  azureProvider,
];

/**
 * Orchestrated service-status lookup.
 *
 * With no query (or "all"), fans out to every configured service and merges the
 * results into one unified response (a combined `services` array plus active
 * `incidents`). With a query like "discord" or "discord,steam,xbox", restricts
 * the fan-out to the named services.
 */
export function lookupStatus(
  query: string,
  type?: LookupType,
  originalQuery?: string,
): DualPromiseResult {
  let providers = filterAndSortProviders(ALL_STATUS_PROVIDERS, config.providersStatus);

  const q = (query || '').trim().toLowerCase();
  if (!ALL_KEYWORDS.has(q)) {
    const wanted = q.split(/[\s,]+/).filter(Boolean);
    const filtered = providers.filter((p) => {
      const name = p.name.toLowerCase();
      // Exact or prefix match only (so "cloud" matches "cloudflare" but "ea"
      // does NOT match "steam").
      return wanted.some((w) => name === w || name.startsWith(w));
    });
    if (filtered.length > 0) {
      providers = filtered;
    }
  }

  return executeProvidersBackground(providers, query, type, originalQuery);
}
