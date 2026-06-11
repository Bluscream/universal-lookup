import { config } from '../config.js';
import type { LookupType, Provider, ProviderResult } from '../types/common.js';

/**
 * Filter and sort providers based on a comma-separated list of names.
 * If names is empty, returns all available providers in their default order.
 */
export function filterAndSortProviders(allProviders: Provider[], names?: string): Provider[] {
  const available = allProviders.filter((p) => p.isAvailable());

  if (!names || names.trim() === '') {
    return available;
  }

  const requestedNames = names
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s !== '');

  if (requestedNames.length === 0) {
    return available;
  }

  // Create a map for quick lookup
  const providerMap = new Map<string, Provider>();
  for (const p of available) {
    const name = p.name.toLowerCase();
    providerMap.set(name, p);
    // Add common aliases
    providerMap.set(name.replace(/[^a-z0-9]/g, ''), p); // e.g. "ip-api-com" -> "ipapicom"
    if (name === '11880') providerMap.set('provider11880', p);
    if (name === 'ip-api.com') providerMap.set('ipapicom', p);
    if (name === 'ip-api.io') providerMap.set('ipapiio', p);
  }

  const sorted: Provider[] = [];
  const seen = new Set<string>();

  for (const name of requestedNames) {
    const cleanName = name.replace(/[^a-z0-9]/g, '');
    const provider = providerMap.get(name) || providerMap.get(cleanName);

    if (provider && !seen.has(provider.name)) {
      sorted.push(provider);
      seen.add(provider.name);
    }
  }

  return sorted;
}

export interface DualPromiseResult {
  clientPromise: Promise<ProviderResult[]>;
  serverPromise: Promise<ProviderResult[]>;
}

/**
 * Execute providers with a dual-timeout strategy.
 * Returns a clientPromise that resolves after CLIENT_TIMEOUT (with whatever is ready or timed out),
 * and a serverPromise that resolves after SERVER_TIMEOUT (with the absolute final results).
 */
export function executeProvidersBackground(
  providers: Provider[],
  query: string,
  type?: LookupType,
  originalQuery?: string,
  options?: { postalCode?: string },
): DualPromiseResult {
  // Wrap each provider execution in a promise that respects the SERVER_TIMEOUT
  const providerPromises = providers.map(async (provider) => {
    try {
      const result = await Promise.race([
        provider.lookup(query, type, originalQuery, options),
        new Promise<ProviderResult>((_, reject) =>
          setTimeout(() => reject(new Error('Timeout')), config.serverTimeout),
        ),
      ]);
      return result;
    } catch (error) {
      return {
        provider: provider.name,
        success: false,
        data: {},
        error: error instanceof Error ? error.message : String(error),
        duration: config.serverTimeout,
      };
    }
  });

  // Client promise: Waits up to CLIENT_TIMEOUT for whatever has finished
  const clientPromise = Promise.all(
    providerPromises.map((p, index) =>
      Promise.race([
        p,
        new Promise<ProviderResult>((resolve) =>
          setTimeout(
            () =>
              resolve({
                provider: providers[index].name,
                success: false,
                data: {},
                error: 'Timeout (Background processing)',
                duration: config.clientTimeout,
              }),
            config.clientTimeout,
          ),
        ),
      ]),
    ),
  );

  // Server promise: Waits up to SERVER_TIMEOUT for absolutely everything
  const serverPromise = Promise.all(providerPromises);

  return { clientPromise, serverPromise };
}
