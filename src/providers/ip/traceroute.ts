import { exec } from 'node:child_process';
import { platform } from 'node:os';
import { promisify } from 'node:util';
import { config } from '../../config.js';
import type { LookupType, Provider, ProviderResult } from '../../types/common.js';

const execAsync = promisify(exec);
const PROVIDER_NAME = 'traceroute';

export const tracerouteProvider: Provider = {
  name: PROVIDER_NAME,
  isAvailable() {
    return true;
  },

  async lookup(query: string, _type?: LookupType): Promise<ProviderResult> {
    const start = Date.now();
    try {
      const isWin = platform() === 'win32';
      const maxHops = 15;
      const cmd = isWin
        ? `tracert -d -h ${maxHops} -w 1000 ${query}`
        : `traceroute -n -m ${maxHops} -w 1 ${query}`;

      const { stdout } = await execAsync(cmd, {
        timeout: Math.min(config.serverTimeout * 2, 30000),
      });

      const { hops, totalHops } = parseTraceroute(stdout, isWin);
      return {
        provider: PROVIDER_NAME,
        success: hops.length > 0,
        data: { hops, hops_count: totalHops },
        raw: stdout,
        duration: Date.now() - start,
      };
    } catch (error: unknown) {
      const err = error as { stdout?: string; message?: string };
      const stdout = err.stdout ?? '';
      if (stdout) {
        const { hops, totalHops } = parseTraceroute(stdout, platform() === 'win32');
        if (hops.length > 0) {
          return {
            provider: PROVIDER_NAME,
            success: true,
            data: { hops, hops_count: totalHops },
            raw: stdout,
            duration: Date.now() - start,
          };
        }
      }
      return {
        provider: PROVIDER_NAME,
        success: false,
        data: {},
        error: err.message ?? String(error),
        duration: Date.now() - start,
      };
    }
  },
};

interface TracerouteHop {
  ip?: string | null;
  rtt_ms?: number | null;
}

function parseTraceroute(
  output: string,
  _isWin: boolean,
): { hops: TracerouteHop[]; totalHops: number } {
  const hops: TracerouteHop[] = [];
  const lines = output.split('\n');
  let maxHopFound = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Match hop number at start of line
    const hopMatch = trimmed.match(/^\s*(\d+)\s+/);
    if (!hopMatch) continue;

    const hop = parseInt(hopMatch[1], 10);
    if (hop < 1 || hop > 64) continue;
    if (hop > maxHopFound) maxHopFound = hop;

    // Extract IP
    const ipMatch = trimmed.match(/(\d+\.\d+\.\d+\.\d+)/);
    const ip = ipMatch ? ipMatch[1] : null;

    // Extract RTT
    const rttMatch = trimmed.match(/(\d+(?:\.\d+)?)\s*ms/);
    const rtt = rttMatch ? parseFloat(rttMatch[1]) : null;

    if (ip || rtt) {
      hops.push({ ip, rtt_ms: rtt });
    }
  }

  return { hops, totalHops: maxHopFound };
}
