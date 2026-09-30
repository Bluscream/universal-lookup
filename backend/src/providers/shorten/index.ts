import {
  type DualPromiseResult,
  executeProvidersBackground,
  filterProviders,
} from '../../lib/providers.js';
import type { LookupType, Provider } from '../../types/common.js';
import { publicProviders } from './public.js';
import { yourls } from './yourls.js';

/**
 * URL shortening.
 *
 * Unlike every other registry here this one writes: each provider creates a
 * real short link on a real service, so the fan-out is the whole point (the
 * caller wants the same URL on several services at once) but it must never
 * happen by accident. Which is why:
 *
 *  - `shorten` has no detectType rule and is not a fallback for anything. It
 *    runs only when a request names it, so a plain URL still goes to `url`.
 *  - Nothing retries. One request per service per lookup.
 *  - The response is cached like any other lookup, which is a feature here:
 *    asking twice for the same URL returns the links that were already made
 *    instead of making more. `?fresh=true` deliberately makes new ones.
 *
 * YOURLS is first so that the merged flat `short_url` is the self-hosted one
 * when an instance is configured.
 */
const ALL_PROVIDERS: Provider[] = [yourls, ...publicProviders];

export function lookupShorten(query: string, type?: LookupType): DualPromiseResult {
  const providers = filterProviders(ALL_PROVIDERS, 'shorten');

  return executeProvidersBackground(providers, query, type);
}

/** Every provider registered for this lookup type, in registry order. */
export const PROVIDERS = ALL_PROVIDERS;

/** Names of every provider registered for this lookup type. */
export const PROVIDER_NAMES: string[] = PROVIDERS.map((p) => p.name);
