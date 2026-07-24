import type {
  LookupType,
  Provider,
  ProviderResult,
  StatusData,
  StatusIncident,
  StatusIndicator,
  StatusServiceEntry,
} from '../../types/common.js';
import { getStatusColor, statusTextForIndicator } from './statuspage.js';

/**
 * Cross-provider signal injection.
 *
 * Status providers each own one source of truth, but some sources describe
 * services that another provider already reports on — crowd-sourced outage
 * reports being the obvious case. Rather than emitting a second, competing
 * entry for the same service, an *enricher* contributes extra signal into an
 * existing provider's result.
 *
 * Enrichment is deliberately **escalate-only**: it can raise a service's
 * severity and add incidents, never lower or clear them. A secondary signal
 * should be able to say "users report this is broken" before the vendor admits
 * it, but must never overrule a vendor that is actively declaring an outage.
 */

/** What an enricher contributes for one service. */
export interface StatusEnrichment {
  /** Severity claimed by this source; only applied when worse than current. */
  indicator?: StatusIndicator;
  /** Incidents to add. */
  incidents?: StatusIncident[];
  /** Arbitrary detail, exposed under `raw.<service>.<enricher name>`. */
  raw?: unknown;
}

export interface StatusEnricher {
  /** Identifier, also the key this enricher's detail lands under in `raw`. */
  name: string;
  /**
   * Optional one-shot warm-up, awaited before any `enrich` call. Use it to pull
   * a shared bulk snapshot so per-service work costs nothing.
   */
  prepare?(): Promise<void>;
  /** Signal for `service`, or null when this source knows nothing about it. */
  enrich(service: string): Promise<StatusEnrichment | null>;
}

const SEVERITY: Record<string, number> = {
  none: 0,
  unknown: 0,
  maintenance: 1,
  minor: 2,
  major: 3,
  critical: 4,
};

function severityOf(indicator?: string): number {
  return SEVERITY[(indicator || '').toLowerCase()] ?? 0;
}

/**
 * Fold one enricher's contribution into a service entry.
 * Returns a new entry; the input is not mutated.
 */
export function applyEnrichment(
  entry: StatusServiceEntry,
  enrichment: StatusEnrichment,
  addedIncidents: number,
): StatusServiceEntry {
  const escalates = severityOf(enrichment.indicator) > severityOf(entry.indicator);
  const indicator = escalates ? (enrichment.indicator as StatusIndicator) : entry.indicator;
  const activeIncidents = (entry.active_incidents ?? 0) + addedIncidents;
  const maintenance = entry.maintenance || indicator === 'maintenance';

  return {
    ...entry,
    indicator,
    // Recompute the one-liner from the escalated severity so the text can never
    // contradict the indicator (an enricher reports one verdict, not a
    // component count, so incident-count escalation doesn't apply here).
    status: escalates ? statusTextForIndicator(indicator) : entry.status,
    operational: entry.operational && !escalates,
    active_incidents: activeIncidents,
    maintenance,
    maintainance: maintenance,
    status_color: getStatusColor(maintenance, activeIncidents, indicator),
  };
}

/** Merge an enricher's detail into a provider's `raw` without clobbering it. */
function mergeRaw(baseRaw: unknown, name: string, detail: unknown): unknown {
  if (detail === undefined) return baseRaw;
  if (baseRaw && typeof baseRaw === 'object' && !Array.isArray(baseRaw)) {
    return { ...(baseRaw as Record<string, unknown>), [name]: detail };
  }
  return { base: baseRaw, [name]: detail };
}

/**
 * Wrap a provider so the given enrichers can inject signal into its results.
 *
 * The provider and every enricher run concurrently, so enrichment costs no
 * extra latency. An enricher that fails or knows nothing about the service is
 * skipped — a secondary source must never be able to break a primary one.
 */
export function withEnrichers(base: Provider, enrichers: StatusEnricher[]): Provider {
  if (enrichers.length === 0) return base;

  return {
    name: base.name,
    isAvailable: () => base.isAvailable(),

    async lookup(
      query: string,
      type?: LookupType,
      originalQuery?: string,
      options?: { postalCode?: string },
    ): Promise<ProviderResult> {
      const [result, ...contributions] = await Promise.all([
        base.lookup(query, type, originalQuery, options),
        ...enrichers.map(async (e) => {
          try {
            await e.prepare?.();
            return { name: e.name, enrichment: await e.enrich(base.name) };
          } catch {
            return { name: e.name, enrichment: null };
          }
        }),
      ]);

      if (!result.success) return result;
      const data = result.data as StatusData;
      const services = data?.services;
      if (!Array.isArray(services) || services.length === 0) return result;

      // A provider may report several services (Steam also reports CS2); only
      // the entry that *is* this provider gets enriched.
      const targetIndex = services.findIndex((s) => s.service === base.name);
      if (targetIndex === -1) return result;

      let entry = services[targetIndex];
      let raw = result.raw;
      const extraIncidents: StatusIncident[] = [];

      for (const { name, enrichment } of contributions) {
        if (!enrichment) continue;
        const incidents = (enrichment.incidents || []).map((i) => ({ ...i, service: base.name }));
        entry = applyEnrichment(entry, enrichment, incidents.length);
        extraIncidents.push(...incidents);
        raw = mergeRaw(raw, name, enrichment.raw);
      }

      const nextServices = [...services];
      nextServices[targetIndex] = entry;

      return {
        ...result,
        raw,
        data: {
          ...data,
          services: nextServices,
          incidents: [...(data.incidents || []), ...extraIncidents],
        },
      };
    },
  };
}

/** Apply the enrichers to every provider in a list. */
export function withEnrichersAll(providers: Provider[], enrichers: StatusEnricher[]): Provider[] {
  if (enrichers.length === 0) return providers;
  return providers.map((p) => withEnrichers(p, enrichers));
}
