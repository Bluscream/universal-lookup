import type {
  LookupType,
  Provider,
  ProviderResult,
  StatusData,
  StatusHistoryPoint,
  StatusIndicator,
} from '../../types/common.js';
import { statusGet } from './http.js';
import { type StatuspageSummary, summaryToStatusData } from './statuspage.js';

export interface UptimeRobotStatistic {
  date: string;
  ratio: string | number;
  label?: string;
  color?: string;
}

export interface UptimeRobotMonitor {
  id?: number;
  name: string;
  status?: string | null;
  statusClass: string; // 'success' | 'danger' | 'warning' | 'paused'
  type?: string;
  dailyRatios?: UptimeRobotStatistic[];
  statistic?: UptimeRobotStatistic[];
  '30dRatio'?: { ratio?: string | number; label?: string; color?: string };
  '90dRatio'?: { ratio?: string | number; label?: string; color?: string };
  ratio?: { ratio?: string | number };
  lastDowntime?: { date?: string; duration?: number; reason?: string } | null;
}

export interface UptimeRobotResponse {
  status?: string;
  data?: UptimeRobotMonitor[];
  statistics?: {
    latest_downtime?: { date?: string; duration?: number; reason?: string } | null;
    counts?: { up?: number; down?: number; paused?: number; total?: number };
    count_result?: string;
  };
  days?: string[];
}

export interface UptimeRobotProviderOptions {
  service: string;
  label: string;
  pspKey: string;
  url: string;
  category?: string;
  brandColor?: string;
  icon?: string;
}

export function uptimerobotToSummary(
  body: UptimeRobotResponse,
  label: string,
  url: string,
): {
  summary: StatuspageSummary;
  history: StatusHistoryPoint[];
  uptime30d: number | null;
  uptime90d: number | null;
} {
  const monitors = body.data || [];
  const counts = body.statistics?.counts;
  const downCount = counts?.down ?? monitors.filter((m) => m.statusClass === 'danger').length;
  const totalCount = counts?.total ?? monitors.length;

  let indicator: StatusIndicator = 'none';
  if (totalCount > 0 && downCount === totalCount) {
    indicator = 'critical';
  } else if (downCount > 0) {
    indicator = downCount >= 2 ? 'major' : 'minor';
  } else if (monitors.some((m) => m.statusClass === 'warning')) {
    indicator = 'minor';
  }

  // Active disruptions as incidents
  const incidents = monitors
    .filter((m) => m.statusClass === 'danger' || m.statusClass === 'warning')
    .map((m) => ({
      name: `${m.name} service disruption`,
      impact: m.statusClass === 'danger' ? 'major' : 'minor',
      status: 'investigating',
      shortlink: url,
      started_at: m.lastDowntime?.date || null,
    }));

  const description =
    indicator === 'none'
      ? 'All Systems Operational'
      : body.statistics?.count_result || `${downCount} of ${totalCount} monitors down`;

  const summary: StatuspageSummary = {
    page: { name: label, url, updated_at: null },
    status: {
      indicator,
      description,
    },
    incidents,
  };

  // Aggregate daily history across all monitors
  const historyMap = new Map<string, { sum: number; count: number }>();
  for (const monitor of monitors) {
    const stats = monitor.dailyRatios || monitor.statistic;
    if (Array.isArray(stats)) {
      for (const stat of stats) {
        if (!stat.date) continue;
        const val = parseFloat(String(stat.ratio));
        if (Number.isNaN(val)) continue;
        const curr = historyMap.get(stat.date) ?? { sum: 0, count: 0 };
        curr.sum += val;
        curr.count += 1;
        historyMap.set(stat.date, curr);
      }
    }
  }

  const history: StatusHistoryPoint[] = [...historyMap.entries()]
    .map(([date, { sum, count }]) => {
      const avg = count > 0 ? Math.round((sum / count) * 1000) / 1000 : 100;
      return {
        date,
        ratio: avg,
        label: avg >= 100 ? 'excellent' : avg >= 99 ? 'good' : 'degraded',
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  // Overall 30d and 90d ratios
  let uptime30d: number | null = null;
  let uptime90d: number | null = null;

  const valid30 = monitors
    .map((m) => parseFloat(String(m['30dRatio']?.ratio)))
    .filter((v) => !Number.isNaN(v));
  if (valid30.length > 0) {
    uptime30d = Math.round((valid30.reduce((a, b) => a + b, 0) / valid30.length) * 1000) / 1000;
  }

  const valid90 = monitors
    .map((m) => parseFloat(String(m['90dRatio']?.ratio)))
    .filter((v) => !Number.isNaN(v));
  if (valid90.length > 0) {
    uptime90d = Math.round((valid90.reduce((a, b) => a + b, 0) / valid90.length) * 1000) / 1000;
  }

  return { summary, history, uptime30d, uptime90d };
}

export function makeUptimeRobotProvider(opts: UptimeRobotProviderOptions): Provider {
  const apiUrl = `https://stats.uptimerobot.com/api/getMonitorList/${opts.pspKey}`;

  return {
    name: opts.service,

    isAvailable() {
      return true;
    },

    async lookup(_query: string, _type?: LookupType): Promise<ProviderResult<StatusData>> {
      const start = Date.now();
      try {
        const resp = await statusGet<UptimeRobotResponse>(apiUrl);
        const { summary, history, uptime30d, uptime90d } = uptimerobotToSummary(
          resp.data || {},
          opts.label,
          opts.url,
        );

        const data = summaryToStatusData(
          summary,
          opts.service,
          opts.label,
          undefined,
          true,
          undefined,
          opts.category,
          opts.brandColor,
          opts.icon,
        );

        if (data.services?.[0]) {
          data.services[0].history = history;
          data.services[0].uptime_30d = uptime30d;
          data.services[0].uptime_90d = uptime90d;
        }

        return {
          provider: opts.service,
          success: true,
          data,
          raw: resp.data,
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

export const UPTIMEROBOT_SERVICES: UptimeRobotProviderOptions[] = [
  {
    service: 'barq',
    label: 'BARQ!',
    pspKey: 'w5P4BUvo3J',
    url: 'https://stats.uptimerobot.com/w5P4BUvo3J',
    category: 'Social',
    brandColor: '#E65100',
    icon: 'https://stats.uptimerobot.com/assets/favicon.ico',
  },
];
