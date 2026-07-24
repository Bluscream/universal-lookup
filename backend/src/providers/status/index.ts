import { config } from '../../config.js';
import {
  type DualPromiseResult,
  executeProvidersBackground,
  filterAndSortProviders,
} from '../../lib/providers.js';
import type { LookupType, Provider } from '../../types/common.js';
import { activisionProvider } from './activision.js';
import {
  ALLESTOERUNGEN_SERVICES,
  crowdEnricher,
  makeAllestoerungenProvider,
} from './allestoerungen.js';
import { awsProvider } from './aws.js';
import { type StatusEnricher, withEnrichersAll } from './enrich.js';
import { maintenanceEnricher } from './maintenance.js';
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
 * Activision/Steam/Ubisoft = bespoke APIs, EA = Instatus), plus any
 * crowd-sourced allestörungen services configured via env.
 */
const BASE_STATUS_PROVIDERS: Provider[] = [
  ...STATUSPAGE_SERVICES.map(makeStatuspageProvider),
  ...INSTATUS_SERVICES.map(makeInstatusProvider),
  ...ALLESTOERUNGEN_SERVICES.map(makeAllestoerungenProvider),
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
 * Secondary signals folded into the providers above. Enrichers can only ever
 * escalate a service (see enrich.ts), so they add early warning and planned
 * downtime without being able to contradict an operator's own feed.
 */
const STATUS_ENRICHERS: StatusEnricher[] = [maintenanceEnricher, crowdEnricher];

const ALL_STATUS_PROVIDERS: Provider[] = withEnrichersAll(
  BASE_STATUS_PROVIDERS,
  STATUS_ENRICHERS,
);

/**
 * The effective PROVIDERS_STATUS list.
 *
 * Services configured through STATUS_ALLESTOERUNGEN_SERVICES are appended
 * automatically, so enabling one only takes a single env var instead of having
 * to remember to also add it here.
 */
function enabledProviderNames(): string {
  const base = config.providersStatus.trim();
  if (!base) return base; // empty = "everything", nothing to append to
  const listed = new Set(
    base
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
  const extra = ALLESTOERUNGEN_SERVICES.map((s) => s.service).filter((s) => !listed.has(s));
  return extra.length > 0 ? `${base},${extra.join(',')}` : base;
}

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
  let providers = filterAndSortProviders(ALL_STATUS_PROVIDERS, enabledProviderNames());

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
