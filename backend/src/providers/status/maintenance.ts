import { config } from '../../config.js';
import type { MaintenanceWindow, StatusIncident } from '../../types/common.js';
import type { StatusEnricher, StatusEnrichment } from './enrich.js';

/**
 * Known recurring maintenance windows, injected as incidents while they're open.
 *
 * Several platforms take predictable weekly downtime that never appears on their
 * own status page (Steam's Tuesday restart being the classic). Declaring those
 * here means one place to manage them, instead of each provider re-implementing
 * "is it Tuesday evening?" — and because this is an enricher it can only ever
 * escalate a service, so a real outage during a maintenance window still wins.
 */

export interface ScheduledMaintenance {
  /** Service ids this applies to, matching provider names. */
  services: string[];
  /** Incident title. Kept stable so consumers don't see it churn. */
  name: string;
  /** Recurring weekly windows, in UTC. */
  windows: MaintenanceWindow[];
  url?: string;
}

/**
 * Built-in windows — the single place to declare them.
 *
 * These used to live inline inside the Steam and Blizzard providers, where they
 * only tripped the `maintenance` flag. Declared here they also surface as a real
 * incident, so "why is Steam down right now?" answers itself.
 */
export const SCHEDULED_MAINTENANCE: ScheduledMaintenance[] = [
  {
    services: ['steam'],
    name: 'Weekly Steam maintenance',
    // Tuesdays from 22:00 UTC, running past midnight.
    windows: [{ utcDay: 2, utcHourStart: 22, utcHourEnd: 2 }],
  },
  {
    services: ['battlenet'],
    name: 'Weekly Battle.net maintenance',
    windows: [{ utcDay: 2, utcHourStart: 14, utcHourEnd: 18 }],
  },
];

/** True when `now` falls inside a weekly UTC window (which may wrap midnight). */
export function isWithinWindow(w: MaintenanceWindow, now: Date = new Date()): boolean {
  const day = now.getUTCDay();
  const hour = now.getUTCHours();
  if (w.utcHourStart > w.utcHourEnd) {
    // Spans midnight, e.g. 22 -> 02.
    if (day === w.utcDay && hour >= w.utcHourStart) return true;
    return day === (w.utcDay + 1) % 7 && hour < w.utcHourEnd;
  }
  return day === w.utcDay && hour >= w.utcHourStart && hour < w.utcHourEnd;
}

/**
 * Parse STATUS_MAINTENANCE_WINDOWS.
 *
 * Format: comma-separated `service:day:start-end[:Name]`, where day is 0=Sunday
 * and start/end are UTC hours. Example:
 *   `steam:2:23-24:Weekly maintenance,vrchat:3:1-3`
 */
export function parseMaintenanceSpecs(raw: string): ScheduledMaintenance[] {
  const out: ScheduledMaintenance[] = [];
  for (const entry of (raw || '').split(',')) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const [service, dayPart, hoursPart, ...nameParts] = trimmed.split(':');
    const day = Number(dayPart);
    const [startPart, endPart] = (hoursPart || '').split('-');
    const start = Number(startPart);
    const end = Number(endPart);
    if (!service || !Number.isInteger(day) || day < 0 || day > 6) continue;
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    out.push({
      services: [service.trim().toLowerCase()],
      name: nameParts.join(':').trim() || 'Scheduled maintenance',
      windows: [{ utcDay: day, utcHourStart: start, utcHourEnd: end }],
    });
  }
  return out;
}

/** All configured windows: built-ins plus anything from the environment. */
export function allMaintenance(): ScheduledMaintenance[] {
  return [...SCHEDULED_MAINTENANCE, ...parseMaintenanceSpecs(config.statusMaintenanceWindows)];
}

/**
 * Enricher that flags a service as under maintenance while one of its declared
 * windows is open.
 */
export const maintenanceEnricher: StatusEnricher = {
  name: 'scheduled_maintenance',

  async enrich(service: string): Promise<StatusEnrichment | null> {
    const now = new Date();
    const open = allMaintenance().filter(
      (m) => m.services.includes(service) && m.windows.some((w) => isWithinWindow(w, now)),
    );
    if (open.length === 0) return null;

    const incidents: StatusIncident[] = open.map((m) => ({
      service,
      name: m.name,
      impact: 'maintenance',
      status: 'in_progress',
      url: m.url ?? null,
      // Left null: these are recurring windows, not dated events, and a moving
      // timestamp would look like a new incident on every poll.
      started_at: null,
      updated_at: null,
    }));

    return {
      indicator: 'maintenance',
      incidents,
      raw: { windows: open.map((m) => ({ name: m.name, windows: m.windows })) },
    };
  },
};
