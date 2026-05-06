import { createConnection, Socket } from 'node:net';
import type { Provider, ProviderResult } from '../../types/common.js';
import { config } from '../../config.js';
import { isIP } from 'node:net';
import { resolve4 } from 'node:dns/promises';

const PROVIDER_NAME = 'portscan';

/** Common ports to scan */
const COMMON_PORTS: Record<number, string> = {
  21: 'FTP', 22: 'SSH', 25: 'SMTP', 53: 'DNS', 80: 'HTTP',
  110: 'POP3', 143: 'IMAP', 443: 'HTTPS', 445: 'SMB',
  993: 'IMAPS', 995: 'POP3S', 3306: 'MySQL', 3389: 'RDP',
  5432: 'PostgreSQL', 6379: 'Redis', 8080: 'HTTP-Alt', 8443: 'HTTPS-Alt',
  27017: 'MongoDB',
};

export const portscanProvider: Provider = {
  name: PROVIDER_NAME,
  isAvailable() { return true; },

  async lookup(query: string): Promise<ProviderResult> {
    const start = Date.now();
    try {
      // Resolve domain to IP if needed
      let target = query;
      if (!isIP(query)) {
        try {
          const addrs = await resolve4(query);
          if (addrs.length > 0) target = addrs[0];
        } catch {
          // Use domain directly
        }
      }

      const timeout = Math.min(2000, config.providerTimeout / 10);
      const portEntries = Object.entries(COMMON_PORTS);

      const results = await Promise.allSettled(
        portEntries.map(([port, service]) =>
          scanPort(target, parseInt(port, 10), timeout).then(open => ({
            port: parseInt(port, 10), service, open,
          }))
        )
      );

      const ports = results
        .filter((r): r is PromiseFulfilledResult<{ port: number; service: string; open: boolean }> => r.status === 'fulfilled')
        .map(r => r.value);

      const openPorts = ports.filter(p => p.open);

      return {
        provider: PROVIDER_NAME, success: true,
        data: {
          open_ports: openPorts.map(p => ({ port: p.port, service: p.service })),
        },
        raw: { all_ports: ports },
        duration: Date.now() - start,
      };
    } catch (error) {
      return { provider: PROVIDER_NAME, success: false, data: {}, error: error instanceof Error ? error.message : String(error), duration: Date.now() - start };
    }
  },
};

function scanPort(host: string, port: number, timeout: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new Socket();
    socket.setTimeout(timeout);
    socket.on('connect', () => { socket.destroy(); resolve(true); });
    socket.on('timeout', () => { socket.destroy(); resolve(false); });
    socket.on('error', () => { socket.destroy(); resolve(false); });
    socket.connect(port, host);
  });
}
