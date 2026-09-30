/**
 * The `app` lookup: one query, every place software comes from.
 *
 * A client asks for "firefox" — or for one package it already has installed —
 * and gets a single list of what each source has and at what version, without
 * caring which source answered. That is why every provider here emits the same
 * `AppEntry` keys (`name`, `version`, `source`, `url`, `license`, …) and why the
 * merger's array concatenation is enough to combine them: they all write to
 * `apps`.
 *
 * This does not replace the `apk` lookup, which stays registered and unchanged.
 * `apk` answers a different question — find this Android package and somewhere
 * to download the file from — and three of the sources here overlap with it only
 * at the edges.
 */

import {
  type DualPromiseResult,
  executeProvidersBackground,
  filterProviders,
} from '../../lib/providers.js';
import type { LookupType, Provider } from '../../types/common.js';
import { fdroidProvider, googleplayProvider, izzyondroidProvider } from './android.js';
import {
  appimagehubProvider,
  flathubProvider,
  homebrewProvider,
  nixpkgsProvider,
} from './crossplatform.js';
import { githubProvider } from './github.js';
import {
  alpineProvider,
  archlinuxProvider,
  aurProvider,
  debianProvider,
  fedoraProvider,
  ubuntuProvider,
} from './linux-distro.js';
import { chocolateyProvider, scoopProvider, wingetProvider } from './windows.js';

/**
 * Registry order is the only order, and it is roughly "most curated first":
 * the platform package managers, then the distributions, then the catalogues,
 * then GitHub — which is the fallback for software no packager carries.
 */
const ALL_PROVIDERS: Provider[] = [
  wingetProvider,
  chocolateyProvider,
  scoopProvider,
  flathubProvider,
  homebrewProvider,
  nixpkgsProvider,
  archlinuxProvider,
  aurProvider,
  debianProvider,
  ubuntuProvider,
  fedoraProvider,
  alpineProvider,
  appimagehubProvider,
  fdroidProvider,
  izzyondroidProvider,
  googleplayProvider,
  githubProvider,
];

export function lookupApp(
  query: string,
  type?: LookupType,
  originalQuery?: string,
): DualPromiseResult {
  const providers = filterProviders(ALL_PROVIDERS, 'app');
  return executeProvidersBackground(providers, query, type, originalQuery);
}

/** Every provider registered for this lookup type, in registry order. */
export const PROVIDERS = ALL_PROVIDERS;

/** Names of every provider registered for this lookup type. */
export const PROVIDER_NAMES: string[] = PROVIDERS.map((p) => p.name);
