import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * config.ts reads the environment once at import, so each case needs a fresh
 * module. vi.resetModules plus a dynamic import is the only way to exercise it.
 */
async function loadHost(env: Record<string, string | undefined>): Promise<string> {
  vi.resetModules();
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    const { config } = await import('../backend/src/config.js');
    return config.host;
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

afterEach(() => {
  vi.resetModules();
});

describe('bind address', () => {
  it('defaults to every interface', async () => {
    expect(await loadHost({ BIND_HOST: undefined, HOST: undefined })).toBe('0.0.0.0');
  });

  it('binds what BIND_HOST asks for', async () => {
    expect(await loadHost({ BIND_HOST: '127.0.0.1', HOST: undefined })).toBe('127.0.0.1');
  });

  it('ignores HOST entirely, because other software writes that name', async () => {
    // The regression: Unraid's Tailscale hook does HOST=$(...tailnet hostname)
    // and execs our command in the same shell, so the app bound a *different
    // node's* address and died with EADDRNOTAVAIL, reading as an app crash.
    expect(await loadHost({ BIND_HOST: undefined, HOST: 'lookup' })).toBe('0.0.0.0');
    expect(await loadHost({ BIND_HOST: '0.0.0.0', HOST: 'lookup' })).toBe('0.0.0.0');
  });
});
