import { exec } from 'node:child_process';
import { platform } from 'node:os';
import { promisify } from 'node:util';
import { config } from '../../config.js';
import type { LookupType, Provider, ProviderResult } from '../../types/common.js';

const execAsync = promisify(exec);
const PROVIDER_NAME = 'ping';

export const pingProvider: Provider = {
  name: PROVIDER_NAME,
  isAvailable() {
    return true;
  },

  async lookup(query: string, _type?: LookupType): Promise<ProviderResult> {
    const start = Date.now();
    try {
      const isWin = platform() === 'win32';
      const t = Math.max(1, Math.floor(config.providerTimeout / 1000));
      const cmd = isWin ? `ping -n 3 -w ${t * 1000} ${query}` : `ping -c 3 -W ${t} ${query}`;
      const { stdout } = await execAsync(cmd, { timeout: config.providerTimeout + 2000 });
      return {
        provider: PROVIDER_NAME,
        success: true,
        data: parsePing(stdout, isWin),
        raw: stdout,
        duration: Date.now() - start,
      };
    } catch (error: unknown) {
      const err = error as { stdout?: string; message?: string };
      const stdout = err.stdout ?? '';
      if (stdout) {
        const d = parsePing(stdout, platform() === 'win32');
        d.ping_alive = false;
        return {
          provider: PROVIDER_NAME,
          success: true,
          data: d,
          raw: stdout,
          duration: Date.now() - start,
        };
      }
      return {
        provider: PROVIDER_NAME,
        success: false,
        data: { ping_alive: false },
        error: err.message ?? String(error),
        duration: Date.now() - start,
      };
    }
  },
};

function parsePing(out: string, isWin: boolean): Record<string, unknown> {
  const d: Record<string, unknown> = {
    ping_alive: false,
    ping_latency_ms: null,
    ping_packet_loss: null,
  };
  if (out.match(/time[=<]/i) || out.match(/Zeit[=<]/i)) d.ping_alive = true;
  if (isWin) {
    const avg = out.match(/(?:Average|Mittelwert)\s*=\s*(\d+)\s*ms/i);
    if (avg) d.ping_latency_ms = parseInt(avg[1], 10);
    const loss = out.match(/\((\d+)%\s*(?:loss|Verlust)\)/i);
    if (loss) d.ping_packet_loss = parseInt(loss[1], 10);
  } else {
    const rtt = out.match(/rtt.*=\s*[\d.]+\/([\d.]+)\/[\d.]+/);
    if (rtt) d.ping_latency_ms = parseFloat(rtt[1]);
    const loss = out.match(/(\d+)%\s*packet loss/);
    if (loss) d.ping_packet_loss = parseInt(loss[1], 10);
  }
  return d;
}
