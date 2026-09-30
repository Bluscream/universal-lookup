import { config } from '../config.js';
import type { LookupOptions, LookupType, Provider, ProviderResult } from '../types/common.js';

/** Punctuation-insensitive form, so "ipapicom" and "ip-api.com" are one name. */
function canonical(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * The single PROVIDERS_BLACKLIST, as a set of canonical names.
 *
 * Read on every call rather than memoised: the list is a handful of entries, and
 * tests reassign `config.providersBlacklist` between cases.
 */
function blacklist(): Set<string> {
  return new Set(
    config.providersBlacklist
      .split(',')
      .map(canonical)
      .filter((s) => s !== ''),
  );
}

/**
 * Whether `name` — a provider, an apk mirror or a whole lookup type — is turned
 * off. One flat namespace, so every name has to mean exactly one thing; the
 * collisions that would break that are pinned in tests/repo-invariants.test.ts.
 */
export function isBlacklisted(name: string): boolean {
  return blacklist().has(canonical(name));
}

/**
 * Providers that should actually run, in registry order.
 *
 * This replaced a per-type allowlist (PROVIDERS_TEL, PROVIDERS_IP, …) whose
 * default value had to repeat every provider name, so adding a provider meant
 * editing config.ts, .env.example and two Unraid templates or it silently never
 * ran. A blacklist defaults to "everything registered", which is what a new
 * provider wants. Registry order is now the only order — the arrays are already
 * written in priority order, and nothing ever depended on reordering via env.
 *
 * A blacklisted `type` runs nothing here as well as being refused by the route,
 * so an internal caller — /auto/ falling back to a web search, or an ip lookup
 * chaining into a domain one — cannot fan out to a type the operator turned off.
 */
export function filterProviders(allProviders: Provider[], type: string): Provider[] {
  if (isBlacklisted(type)) return [];
  return allProviders.filter((p) => p.isAvailable() && !isBlacklisted(p.name));
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
  options?: LookupOptions,
): DualPromiseResult {
  // SERVER_TIMEOUT unless the caller asked for longer — see LookupOptions.
  const serverTimeout = options?.timeoutMs ?? config.serverTimeout;

  // Wrap each provider execution in a promise that respects that deadline
  const providerPromises = providers.map(async (provider) => {
    // Losing the race does not cancel the timer, and a /status fan-out starts
    // ~30 of these. Left uncleared they hold the event loop open for the full
    // SERVER_TIMEOUT after the response has already been sent, which is why
    // the process did not exit promptly on SIGTERM.
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        provider.lookup(query, type, originalQuery, options),
        new Promise<ProviderResult>((_, reject) => {
          timer = setTimeout(() => reject(new Error('Timeout')), serverTimeout);
        }),
      ]);
      return result;
    } catch (error) {
      return {
        provider: provider.name,
        success: false,
        data: {},
        error: error instanceof Error ? error.message : String(error),
        duration: serverTimeout,
      };
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  });

  // Client promise: Waits up to CLIENT_TIMEOUT for whatever has finished
  const clientPromise = Promise.all(
    providerPromises.map(async (p, index) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          p,
          new Promise<ProviderResult>((resolve) => {
            timer = setTimeout(
              () =>
                resolve({
                  provider: providers[index].name,
                  success: false,
                  data: {},
                  error: 'Timeout (Background processing)',
                  duration: config.clientTimeout,
                }),
              config.clientTimeout,
            );
          }),
        ]);
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    }),
  );

  // Server promise: Waits up to SERVER_TIMEOUT for absolutely everything
  const serverPromise = Promise.all(providerPromises);

  return { clientPromise, serverPromise };
}
