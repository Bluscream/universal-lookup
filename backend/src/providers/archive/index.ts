/**
 * The `archive` lookup: what web archives hold this URL, and — only if asked —
 * publish it to the ones that will take it.
 *
 * Saving is the thing this registry is careful about. Every other lookup type
 * here reads: it asks a third party a question and the world is unchanged
 * afterwards. An archive save is the opposite — it publishes the queried URL to
 * a public, permanent, third-party archive, and there is no taking it back. A
 * private staging URL submitted by accident is then public forever.
 *
 * So the default path is read-only, and saving is opt-in per request
 * (`?save=true`), with ARCHIVE_SAVE_ENABLED over the top of it for an operator
 * who wants the endpoint to be readable but never writable. Nothing about a
 * plain `/archive/<url>` lookup touches the world.
 *
 * This type is also never a fallback for another one, and `detectType` has no
 * rule that routes a bare URL here — `url` keeps those. Reaching this registry
 * is always something the caller spelled out.
 */

import { config } from '../../config.js';
import {
  type DualPromiseResult,
  executeProvidersBackground,
  filterProviders,
} from '../../lib/providers.js';
import type { LookupOptions, LookupType, Provider } from '../../types/common.js';
import { archiveToday } from './archive-today.js';
import { arquivoPt } from './arquivo.js';
import { ghostarchive } from './ghostarchive.js';
import { permaCc } from './perma-cc.js';
import { wayback } from './wayback.js';

const ALL_PROVIDERS: Provider[] = [wayback, archiveToday, ghostarchive, arquivoPt, permaCc];

export function lookupArchive(
  query: string,
  type: LookupType = 'archive',
  originalQuery?: string,
  options?: LookupOptions,
): DualPromiseResult {
  const providers = filterProviders(ALL_PROVIDERS, type);
  // ARCHIVE_SAVE_ENABLED is the operator's veto, applied here rather than in
  // each provider so there is one place that decides whether this deployment
  // may publish anything at all.
  const saving = config.archiveSaveEnabled && options?.save === true;
  // A save needs far longer than SERVER_TIMEOUT, and abandoning one at the
  // deadline does not undo it — the archive keeps capturing either way, so the
  // only thing a short deadline buys is not learning the result.
  const effective: LookupOptions = saving
    ? { ...options, save: true, timeoutMs: config.archiveSaveTimeout }
    : { ...options, save: false };

  return executeProvidersBackground(providers, query, type, originalQuery, effective);
}

/** Every provider registered for this lookup type, in registry order. */
export const PROVIDERS = ALL_PROVIDERS;

/** Names of every provider registered for this lookup type. */
export const PROVIDER_NAMES: string[] = PROVIDERS.map((p) => p.name);
