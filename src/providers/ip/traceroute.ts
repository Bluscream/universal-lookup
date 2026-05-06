import { exec } from 'node:child_process';
import { platform } from 'node:os';
import { promisify } from 'node:util';
import { config } from '../../config.js';
import type { Provider, ProviderResult } from '../../types/common.js';

const execAsync = promisify(exec);
const PROVIDER_NAME = 'traceroute';

export const tracerouteProvider: Provider = {
  name: PROVIDER_NAME,
  isAvailable() {
    return true;
  },

  async lookup(query: string): Promise<ProviderResult> {
    const start = Date.now();
    try {
      const isWin = platform() === 'win32';
      const maxHops = 15;
      const cmd = isWin
        ? `tracert -d -h ${maxHops} -w 1000 ${query}`
        : `traceroute -n -m ${maxHops} -w 1 ${query}`;

      const { stdout } = await execAsync(cmd, {
        timeout: Math.min(config.providerTimeout * 2, 30000),
      });

      const hops = parseTraceroute(stdout, isWin);
      return {
        provider: PROVIDER_NAME,
        success: hops.length > 0,
        data: { hops },
        raw: stdout,
        duration: Date.now() - start,
      };
    } catch (error: unknown) {
      const err = error as { stdout?: string; message?: string };
      const stdout = err.stdout ?? '';
      if (stdout) {
        const hops = parseTraceroute(stdout, platform() === 'win32');
        if (hops.length > 0) {
          return {
            provider: PROVIDER_NAME,
            success: true,
            data: { hops },
            raw: stdout,
            duration: Date.now() - start,
          };
        }
      }
      return { provider: PROVIDER_NAME, success: false, data: {}, error: err.message ?? String(error), duration: Date.now() - start };
    }
  },
};

interface TracerouteHop {
  hop: number;
  ip: string | null;
  rtt_ms: number | null;
}

function parseTraceroute(output: string, _isWin: boolean): TracerouteHop[] {
  const hops: TracerouteHop[] = [];
  const lines = output.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Match hop number at start of line
    const hopMatch = trimmed.match(/^\s*(\d+)\s+/);
    if (!hopMatch) continue;

    const hop = parseInt(hopMatch[1], 10);
    if (hop < 1 || hop > 64) continue;

    // Extract IP
    const ipMatch = trimmed.match(/(\d+\.\d+\.\d+\.\d+)/);
    const ip = ipMatch ? ipMatch[1] : null;

    // Extract RTT
    const rttMatch = trimmed.match(/(\d+(?:\.\d+)?)\s*ms/);
    const rtt = rttMatch ? parseFloat(rttMatch[1]) : null;

    // Skip "Request timed out" / "* * *" lines that have no data
    if (!ip && !rtt && (trimmed.includes('*') || trimmed.includes('timed out'))) {
      hops.push({ hop, ip: null, rtt_ms: null });
      continue;
    }

    hops.push({ hop, ip, rtt_ms: rtt });
  }

  return hops;
}

