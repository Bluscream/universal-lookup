import { config } from '../config.js';

/**
 * One place that records every external process this service starts.
 *
 * The service leaves its own process in three places — headless Chromium,
 * `ping` and `traceroute` — and until now none of them said so. That made a
 * real incident hard to see: a Chromium that outlived the request which
 * launched it was only discoverable by running `ps` inside the container after
 * the fact, and the fan-out that started it (one browser page per configured
 * status service) was invisible entirely. Logging each spawn, and each exit
 * with the lifetime it had, puts both in `docker logs`.
 *
 * Volume is deliberately accepted on page opens: a cold `/api/status/all`
 * fans out to one page per status service, and seeing those lines *is* the
 * diagnostic. Set LOG_SPAWNS=false to silence the whole module.
 */

/** Distinguishes the kinds so the counters below are per-kind, not global. */
export type ProcKind = 'browser' | 'page' | 'exec';

const ICONS: Record<ProcKind, string> = {
  browser: '🧭',
  page: '📄',
  exec: '⚙️',
};

let sequence = 0;
const totals = new Map<ProcKind, number>();

export interface ProcHandle {
  id: string;
  kind: ProcKind;
  label: string;
  startedAt: number;
}

/** `{a: 1, b: 'x'}` -> ` a=1 b=x`, and nothing at all when empty. */
function fields(extra?: Record<string, unknown>): string {
  if (!extra) return '';
  const parts = Object.entries(extra)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${v}`);
  return parts.length ? ` ${parts.join(' ')}` : '';
}

/**
 * Record that an external process is starting. The returned handle carries the
 * start time, so callers do not each have to track it for {@link procEnd}.
 */
export function procStart(
  kind: ProcKind,
  label: string,
  extra?: Record<string, unknown>,
): ProcHandle {
  const id = `${kind}#${++sequence}`;
  const total = (totals.get(kind) ?? 0) + 1;
  totals.set(kind, total);

  if (config.logSpawns) {
    console.log(`${ICONS[kind]} spawn ${id} ${label}${fields(extra)} (${kind} total ${total})`);
  }
  return { id, kind, label, startedAt: Date.now() };
}

/**
 * Record that a process started by {@link procStart} has gone away. `outcome`
 * is the *reason* it ended — "idle-timeout", "shutdown", "ok", "error: …" —
 * because for the browser that reason is the whole point: an idle-timeout
 * close is the timer working, a shutdown close is the process exiting, and no
 * close at all before the next spawn is the bug this module exists to show.
 */
export function procEnd(
  handle: ProcHandle,
  outcome: string,
  extra?: Record<string, unknown>,
): void {
  if (!config.logSpawns) return;
  const ms = Date.now() - handle.startedAt;
  console.log(
    `${ICONS[handle.kind]} exit  ${handle.id} ${handle.label} after ${ms}ms — ${outcome}${fields(extra)}`,
  );
}

/** Cumulative spawn counts per kind, for diagnostics and tests. */
export function procTotals(): Record<string, number> {
  return Object.fromEntries(totals);
}

/** Reset the counters. Tests only — the sequence deliberately keeps climbing. */
export function resetProcTotals(): void {
  totals.clear();
}
