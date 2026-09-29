import { describe, expect, it } from 'vitest';
import { isValidHost, normalizeIp } from '../backend/src/lib/normalizer.js';
import { pingProvider } from '../backend/src/providers/ip/ping.js';
import { tracerouteProvider } from '../backend/src/providers/ip/traceroute.js';

// Regression tests for the command injection in the ping/traceroute providers,
// which built a shell string out of the user-supplied host.
describe('host validation', () => {
  it('accepts ordinary addresses and hostnames', () => {
    for (const host of ['127.0.0.1', '8.8.8.8', '::1', '2606:4700:4700::1111', 'example.com']) {
      expect(isValidHost(host), host).toBe(true);
    }
  });

  it('rejects every shell metacharacter that could start a second command', () => {
    const hostile = [
      '127.0.0.1; echo pwned',
      '127.0.0.1;id',
      '127.0.0.1 && whoami',
      '127.0.0.1|cat /etc/passwd',
      '$(id)',
      '`id`',
      '127.0.0.1\nid',
      '127.0.0.1 -f',
      '--help',
      '',
    ];
    for (const host of hostile) {
      expect(isValidHost(host), host).toBe(false);
    }
  });

  it('rejects a hostname longer than the DNS limit', () => {
    expect(isValidHost(`${'a'.repeat(254)}.com`)).toBe(false);
  });
});

describe('shell injection is not reachable through the network providers', () => {
  // normalizeIp passes unresolvable input straight through, so the provider is
  // the only thing standing between a hostile query and the command line.
  it('normalizeIp still passes metacharacters through, so the guard must hold', async () => {
    expect(await normalizeIp('127.0.0.1; echo marker')).toContain(';');
  });

  it('ping refuses a query carrying a shell command', async () => {
    const result = await pingProvider.lookup('127.0.0.1; echo marker');

    expect(result.success).toBe(false);
    expect(result.error).toBe('Invalid host');
    expect(String(result.raw ?? '')).not.toContain('marker');
  });

  it('traceroute refuses a query carrying a shell command', async () => {
    const result = await tracerouteProvider.lookup('127.0.0.1; echo marker');

    expect(result.success).toBe(false);
    expect(result.error).toBe('Invalid host');
    expect(String(result.raw ?? '')).not.toContain('marker');
  });

  it('still pings a legitimate address', async () => {
    const result = await pingProvider.lookup('127.0.0.1');

    expect(result.error).not.toBe('Invalid host');
  }, 20000);
});
