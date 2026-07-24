import { config } from '../../config.js';
import type {
  LookupType,
  Provider,
  ProviderResult,
  StatusData,
  StatusIndicator,
  MaintenanceWindow,
} from '../../types/common.js';
import { statusGet } from './http.js';
import { serviceCategory, serviceIconUrl, serviceColor } from './icons.js';

export interface StatuspageProviderOptions {
  /** Provider/service id, e.g. "discord". */
  service: string;
  /** Human-friendly service name, e.g. "Discord". */
  label: string;
  /** The `summary.json` endpoint. */
  url: string;
  /** Optional recurring maintenance windows */
  maintenanceTimes?: MaintenanceWindow[];
  /** Optional custom category */
  category?: string;
  /** Optional custom brand accent color */
  brandColor?: string;
  /** Optional custom icon name/slug or full URL */
  icon?: string;
}

/** Registry of services that expose a standard Statuspage `summary.json`. */
export const STATUSPAGE_SERVICES: StatuspageProviderOptions[] = [
  {
    service: 'discord',
    label: 'Discord',
    url: 'https://discordstatus.com/api/v2/summary.json',
    category: 'Web',
    brandColor: '#5865F2',
    icon: 'discord',
  },
  {
    service: 'vrchat',
    label: 'VRChat',
    url: 'https://status.vrchat.com/api/v2/summary.json',
    category: 'Games',
    brandColor: '#1FD1EC',
    icon: 'vrchat',
  },
  {
    service: 'cloudflare',
    label: 'Cloudflare',
    url: 'https://www.cloudflarestatus.com/api/v2/summary.json',
    category: 'Cloud',
    brandColor: '#F38020',
    icon: 'cloudflare',
  },
  {
    service: 'github',
    label: 'GitHub',
    url: 'https://www.githubstatus.com/api/v2/summary.json',
    category: 'Web',
    brandColor: '#24292e',
    icon: 'github',
  },
  {
    service: 'epic',
    label: 'Epic Games',
    url: 'https://status.epicgames.com/api/v2/summary.json',
    category: 'Games',
    brandColor: '#313131',
    icon: 'epicgames',
  },
  {
    service: 'reddit',
    label: 'Reddit',
    url: 'https://www.redditstatus.com/api/v2/summary.json',
    category: 'Web',
    brandColor: '#FF4500',
    icon: 'reddit',
  },
  {
    service: 'twitch',
    label: 'Twitch',
    url: 'https://status.twitch.com/api/v2/summary.json',
    category: 'Web',
    brandColor: '#9146FF',
    icon: 'twitch',
  },
  // Cloud / hosting providers (Atlassian Statuspage)
  {
    service: 'vercel',
    label: 'Vercel',
    url: 'https://www.vercel-status.com/api/v2/summary.json',
    category: 'Cloud',
    brandColor: '#000000',
    icon: 'vercel',
  },
  {
    service: 'digitalocean',
    label: 'DigitalOcean',
    url: 'https://status.digitalocean.com/api/v2/summary.json',
    category: 'Cloud',
    brandColor: '#0080FF',
    icon: 'digitalocean',
  },
  {
    service: 'netlify',
    label: 'Netlify',
    url: 'https://www.netlifystatus.com/api/v2/summary.json',
    category: 'Cloud',
    brandColor: '#00C7B7',
    icon: 'netlify',
  },
  {
    service: 'mongodb',
    label: 'MongoDB',
    url: 'https://status.mongodb.com/api/v2/summary.json',
    category: 'Cloud',
    brandColor: '#47A248',
    icon: 'mongodb',
  },
  // Dev tools / web / social (Atlassian Statuspage)
  {
    service: 'sentry',
    label: 'Sentry',
    url: 'https://status.sentry.io/api/v2/summary.json',
    category: 'Web',
    brandColor: '#362D59',
    icon: 'sentry',
  },
  // Bluesky's custom status domain doesn't serve the API; use its Statuspage id.
  {
    service: 'bluesky',
    label: 'Bluesky',
    url: 'https://zp3d53cvflx3.statuspage.io/api/v2/summary.json',
    category: 'Web',
    brandColor: '#0085FF',
    icon: 'bluesky',
  },
  // AI providers (Atlassian Statuspage)
  {
    service: 'openai',
    label: 'OpenAI',
    url: 'https://status.openai.com/api/v2/summary.json',
    category: 'AI',
    brandColor: '#412991',
    icon: 'ri/openai-fill',
  },
  {
    service: 'claude',
    label: 'Claude',
    url: 'https://status.claude.com/api/v2/summary.json',
    category: 'AI',
    brandColor: '#D97706',
    icon: 'claude',
  },
  {
    service: 'windsurf',
    label: 'Windsurf',
    url: 'https://status.windsurf.com/api/v2/summary.json',
    category: 'AI',
    brandColor: '#00B0FF',
    icon: 'windsurf',
  },
  {
    service: 'devin',
    label: 'Devin',
    url: 'https://www.devinstatus.com/api/v2/summary.json',
    category: 'AI',
    brandColor: '#FFD700',
    icon: 'mdi/robot-happy',
  },
];


let _ignoredCache: { raw: string; set: Set<string> } | null = null;
const _incidentFirstSeen = new Map<string, string>();

export function clearIncidentCache() {
  _incidentFirstSeen.clear();
}

/** Parsed STATUS_IGNORED list (lower-cased), memoized on the raw config string. */
function ignoredIssues(): Set<string> {
  const raw = config.statusIgnored;
  if (!_ignoredCache || _ignoredCache.raw !== raw) {
    _ignoredCache = {
      raw,
      set: new Set(
        raw
          .split(';')
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean),
      ),
    };
  }
  return _ignoredCache.set;
}

/** True if an incident name matches any ignored entry (case-insensitive substring). */
function isIgnored(name: string, ignored: Set<string>): boolean {
  if (ignored.size === 0) return false;
  const n = (name || '').trim().toLowerCase();
  if (ignored.has(n)) return true;
  for (const ig of ignored) {
    if (n.includes(ig)) return true;
  }
  return false;
}

/**
 * Atlassian Statuspage v2 `summary.json` shape — the de-facto standard used by
 * Discord, Cloudflare, GitHub, Reddit, Twitch, VRChat, Epic Games, and many more.
 *
 * This is also our **canonical intermediate format**: every provider (including
 * the proprietary Xbox / PlayStation / Activision feeds) converts its response
 * into a `StatuspageSummary` and then runs it through {@link summaryToStatusData},
 * so all providers emit an identical unified shape (and identical `raw`).
 */
export interface StatuspageSummary {
  page?: { name?: string; url?: string; updated_at?: string | null };
  status?: { indicator?: string; description?: string };
  components?: unknown[];
  incidents?: Array<{
    name?: string;
    status?: string | null;
    impact?: string | null;
    shortlink?: string | null;
    created_at?: string | null;
    started_at?: string | null;
    updated_at?: string | null;
  }>;
  scheduled_maintenances?: Array<{
    name?: string;
    status?: string | null;
    impact?: string | null;
    shortlink?: string | null;
    created_at?: string | null;
    started_at?: string | null;
    updated_at?: string | null;
    scheduled_for?: string | null;
    scheduled_until?: string | null;
  }>;
}

/** Statuspage indicators map 1:1 to our canonical indicators. */
export function normalizeIndicator(indicator?: string): StatusIndicator {
  switch ((indicator || '').toLowerCase()) {
    case 'none':
      return 'none';
    case 'minor':
      return 'minor';
    case 'major':
      return 'major';
    case 'critical':
      return 'critical';
    case 'maintenance':
      return 'maintenance';
    default:
      return 'unknown';
  }
}

/**
 * Produce the concise one-line status label shown in the UI.
 *
 * Operational is always "All Systems Operational". For `verbatim` feeds (native
 * Statuspage / Instatus) the upstream one-liner is kept as-is. Otherwise the
 * label is normalized: maintenance -> "Under Maintenance", a single active
 * incident -> "Minor Service Outage", more than one -> "Major Service Outage".
 */
/**
 * The one-line label implied by a severity on its own.
 *
 * {@link normalizeStatusText} escalates on the *number* of active incidents,
 * which is the right call for feeds that list every affected component but
 * wrong for sources that report a single verdict (crowd reports, maintenance
 * windows) — those would always read "Minor" no matter how bad it is.
 */
export function statusTextForIndicator(indicator: StatusIndicator): string {
  switch (indicator) {
    case 'none':
      return 'All Systems Operational';
    case 'maintenance':
      return 'Under Maintenance';
    case 'minor':
      return 'Minor Service Outage';
    case 'major':
      return 'Major Service Outage';
    case 'critical':
      return 'Total Service Outage';
    default:
      return 'Status Unknown';
  }
}

export function normalizeStatusText(
  indicator: StatusIndicator,
  activeIncidents: number,
  description: string | undefined,
  verbatim: boolean,
): string {
  if (indicator === 'none') return 'All Systems Operational';
  if (verbatim && description) return description;
  if (indicator === 'maintenance') return 'Under Maintenance';
  return activeIncidents >= 3 ? 'Major Service Outage' : 'Minor Service Outage';
}

function isScheduledMaintenanceTime(windows?: MaintenanceWindow[]): boolean {
  if (!windows || windows.length === 0) return false;
  const now = new Date();
  const utcDay = now.getUTCDay(); // 0 = Sun, 1 = Mon, 2 = Tue, 3 = Wed, ...
  const utcHour = now.getUTCHours();

  for (const w of windows) {
    // If the window spans past midnight (e.g. 22 to 2)
    if (w.utcHourStart > w.utcHourEnd) {
      if (utcDay === w.utcDay && utcHour >= w.utcHourStart) return true;
      if (utcDay === (w.utcDay + 1) % 7 && utcHour < w.utcHourEnd) return true;
    } else {
      if (utcDay === w.utcDay && utcHour >= w.utcHourStart && utcHour < w.utcHourEnd) return true;
    }
  }
  return false;
}

function resolveIcon(icon?: string, service?: string): string | null {
  if (!icon) return serviceIconUrl(service || '');
  if (icon.startsWith('http')) return icon;
  const mapped = serviceIconUrl(icon);
  if (mapped) return mapped;
  if (icon.includes('/')) return `https://api.iconify.design/${icon}.svg`;
  return `https://cdn.simpleicons.org/${icon}`;
}

export function getStatusColor(isMaint: boolean, incidentCount: number, indicator: string): string {
  if (isMaint) return '#3b82f6'; // light blue
  if (incidentCount === 1) return '#eab308'; // yellow
  if (incidentCount === 2) return '#f97316'; // orange
  if (incidentCount >= 3) return '#ef4444'; // red
  if (indicator === 'minor') return '#eab308';
  if (indicator === 'major') return '#f97316';
  if (indicator === 'critical') return '#ef4444';
  return '#22c55e'; // default light green
}

function checkIsMaintenance(
  indicator: string,
  status: string,
  label: string,
  times?: MaintenanceWindow[],
  incidents: Array<{ impact?: string | null; name?: string | null; status?: string | null }> = [],
): boolean {
  return (
    indicator === 'maintenance' ||
    /mainten/i.test(status) ||
    /mainten/i.test(label) ||
    isScheduledMaintenanceTime(times) ||
    incidents.some(
      (inc) =>
        inc.impact === 'maintenance' ||
        (inc.name && /mainten/i.test(inc.name)) ||
        (inc.status && /mainten/i.test(inc.status)),
    )
  );
}

/**
 * Convert a canonical {@link StatuspageSummary} into our unified {@link StatusData}
 * (a single-element `services` array plus active `incidents`). Shared by every
 * provider so proprietary formats come out identical to native Statuspage ones.
 */
export function summaryToStatusData(
  summary: StatuspageSummary,
  service: string,
  label: string,
  ignored: Set<string> = ignoredIssues(),
  /**
   * When true, keep the upstream `summary.status.description` verbatim (for
   * feeds that already return a short, concise one-line status — native
   * Atlassian Statuspage and Instatus). When false (default, for our
   * hand-rolled providers) the status text is normalized to a consistent
   * "All Systems Operational / Minor Service Outage / Major Service Outage /
   * Under Maintenance" set so the UI reads uniformly.
   */
  verbatim: boolean = false,
  maintenanceTimes?: MaintenanceWindow[],
  category?: string,
  brandColor?: string,
  icon?: string,
): StatusData {
  const times = maintenanceTimes;
  let indicator = normalizeIndicator(summary.status?.indicator);

  const allIncidents = [
    ...(summary.incidents || []),
    ...(summary.scheduled_maintenances || []).map((m) => ({
      ...m,
      impact: m.impact || 'maintenance',
    })),
  ];

  // Only surface incidents that are not yet resolved.
  const unresolved = allIncidents.filter(
    (i) =>
      (i.status || '').toLowerCase() !== 'resolved' &&
      (i.status || '').toLowerCase() !== 'completed',
  );
  // Drop ignored incidents (STATUS_IGNORED).
  const activeIncidents = unresolved.filter((i) => !isIgnored(i.name || '', ignored));

  // If a service's only incidents were all ignored, treat it as operational.
  const allIgnored = unresolved.length > 0 && activeIncidents.length === 0;
  if (indicator !== 'none' && allIgnored) indicator = 'none';

  const operational = indicator === 'none';

  const uniqueIncidents: typeof mappedIncidents = [];
  const seenKeys = new Set<string>();

  const mappedIncidents = activeIncidents.map((i) => {
    const key = JSON.stringify([service, i.name || 'Incident']);
    // Prefer scheduled_for (the actual time a maintenance starts) over started_at (often just the post creation time).
    let started = (i as any).scheduled_for || i.started_at || i.created_at || null;

    // For stateless feeds (Steam, Blizzard), assign a started_at the first time we see it
    if (!started) {
      if (_incidentFirstSeen.has(key)) {
        started = _incidentFirstSeen.get(key)!;
      } else {
        started = new Date().toISOString();
        _incidentFirstSeen.set(key, started);
      }
    }

    return {
      service,
      name: i.name || 'Incident',
      impact: i.impact || null,
      status: i.status || null,
      url: i.shortlink || null,
      started_at: started,
      updated_at: i.updated_at || null,
      scheduled_until: (i as any).scheduled_until || null,
    };
  });

  const now = Date.now();
  for (const inc of mappedIncidents) {
    const startMs = inc.started_at ? new Date(inc.started_at).getTime() : 0;
    // Hide future scheduled events unless they're already marked as in-progress.
    // Add a 5 minute grace period for clock skew.
    if (startMs > now + 5 * 60000 && inc.status !== 'in_progress') {
      continue;
    }

    const key = JSON.stringify([
      inc.service,
      inc.name,
      inc.impact,
      inc.status,
      inc.url,
      inc.started_at,
      inc.updated_at
    ]);
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      uniqueIncidents.push(inc);
    }
  }

  // Clean up resolved incidents from the tracking map for this service
  for (const k of _incidentFirstSeen.keys()) {
    try {
      const parsed = JSON.parse(k);
      if (parsed[0] === service && !seenKeys.has(k)) {
        _incidentFirstSeen.delete(k);
      }
    } catch {}
  }

  const status = normalizeStatusText(
    indicator,
    uniqueIncidents.length,
    summary.status?.description,
    verbatim,
  );

  const isMaint = checkIsMaintenance(indicator, status, label, times, uniqueIncidents);

  const statusColor = getStatusColor(isMaint, uniqueIncidents.length, indicator);

  return {
    services: [
      {
        service,
        name: label,
        indicator,
        status,
        operational,
        updated_at: summary.page?.updated_at || null,
        page_url: summary.page?.url || null,
        icon: resolveIcon(icon, service),
        category: category || serviceCategory(service),
        active_incidents: uniqueIncidents.length,
        maintenance: isMaint,
        maintainance: isMaint,
        status_color: statusColor,
        service_color: brandColor || serviceColor(service),
      },
    ],
    incidents: uniqueIncidents,
  };
}



/**
 * Build a status Provider backed by a native Atlassian Statuspage `summary.json`
 * endpoint. The body is already in canonical form, so it goes straight through
 * {@link summaryToStatusData}.
 */
export function makeStatuspageProvider(opts: StatuspageProviderOptions): Provider {
  return {
    name: opts.service,

    isAvailable() {
      return true;
    },

    async lookup(_query: string, _type?: LookupType): Promise<ProviderResult<StatusData>> {
      const start = Date.now();
      try {
        const resp = await statusGet<StatuspageSummary>(opts.url);
        const summary = resp.data || {};
        return {
          provider: opts.service,
          success: true,
          data: summaryToStatusData(
            summary,
            opts.service,
            opts.label,
            undefined,
            true,
            opts.maintenanceTimes,
            opts.category,
            opts.brandColor,
            opts.icon,
          ),
          raw: summary,
          duration: Date.now() - start,
        };
      } catch (error) {
        return {
          provider: opts.service,
          success: false,
          data: {},
          error: error instanceof Error ? error.message : String(error),
          duration: Date.now() - start,
        };
      }
    },
  };
}


