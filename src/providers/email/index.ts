import { config } from '../../config.js';
import type { Provider, ProviderResult } from '../../types/common.js';
import { dnsEmail } from './dns-email.js';
import { ipApiIoAdvEmail } from './ip-api-io-adv.js';
import { ipApiIoEmail } from './ip-api-io-email.js';
import { ipApiIoEmailRisk } from './ip-api-io-risk.js';

const ALL_PROVIDERS: Provider[] = [dnsEmail, ipApiIoEmail, ipApiIoAdvEmail, ipApiIoEmailRisk];

export async function lookupEmail(query: string): Promise<ProviderResult[]> {
  const providers = ALL_PROVIDERS.filter((p) => p.isAvailable());
  const results = await Promise.allSettled(
    providers.map((provider) =>
      Promise.race([
        provider.lookup(query),
        new Promise<ProviderResult>((_, reject) =>
          setTimeout(() => reject(new Error('Timeout')), config.providerTimeout),
        ),
      ]).catch(
        (error): ProviderResult => ({
          provider: provider.name,
          success: false,
          data: {},
          error: error instanceof Error ? error.message : String(error),
          duration: config.providerTimeout,
        }),
      ),
    ),
  );
  return results.map((r) =>
    r.status === 'fulfilled'
      ? r.value
      : { provider: 'unknown', success: false, data: {}, error: 'Promise rejected', duration: 0 },
  );
}
