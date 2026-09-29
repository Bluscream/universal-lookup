import { beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../backend/src/config.js';
import { procEnd, procStart, procTotals, resetProcTotals } from '../backend/src/lib/proc-log.js';

describe('proc-log', () => {
  beforeEach(() => {
    resetProcTotals();
    config.logSpawns = true;
    vi.restoreAllMocks();
  });

  it('logs a spawn with its kind, label and per-kind running total', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    procStart('browser', '/usr/bin/chromium', { pid: 42 });

    expect(log).toHaveBeenCalledOnce();
    const line = log.mock.calls[0][0] as string;
    expect(line).toContain('spawn');
    expect(line).toContain('browser#');
    expect(line).toContain('/usr/bin/chromium');
    expect(line).toContain('pid=42');
    expect(line).toContain('browser total 1');
  });

  it('reports the reason an external process ended, and its lifetime', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const handle = procStart('browser', '/usr/bin/chromium');
    log.mockClear();

    procEnd(handle, 'idle-timeout', { pages: 3 });

    const line = log.mock.calls[0][0] as string;
    expect(line).toContain('exit');
    expect(line).toContain('idle-timeout');
    expect(line).toContain('pages=3');
    expect(line).toMatch(/after \d+ms/);
  });

  it('counts each kind separately so page fan-out is visible', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});

    procStart('browser', 'chromium');
    for (let i = 0; i < 5; i++) procStart('page', `https://example.test/${i}`);
    procStart('exec', 'ping');

    expect(procTotals()).toEqual({ browser: 1, page: 5, exec: 1 });
  });

  it('omits empty, null and undefined fields rather than printing them', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    procStart('exec', 'traceroute', { host: 'example.test', maxHops: undefined, note: '' });

    const line = log.mock.calls[0][0] as string;
    expect(line).toContain('host=example.test');
    expect(line).not.toContain('maxHops');
    expect(line).not.toContain('note');
  });

  it('stays silent when LOG_SPAWNS is off, but still counts', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    config.logSpawns = false;

    const handle = procStart('page', 'https://example.test');
    procEnd(handle, 'ok');

    expect(log).not.toHaveBeenCalled();
    // Counters stay live so a diagnostics endpoint keeps working with logs off.
    expect(procTotals()).toEqual({ page: 1 });
  });
});
