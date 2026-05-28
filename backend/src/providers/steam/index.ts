import { config } from '../../config.js';
import {
  type DualPromiseResult,
  executeProvidersBackground,
  filterAndSortProviders,
} from '../../lib/providers.js';
import type { LookupType, Provider } from '../../types/common.js';
import { backpackTfProvider } from './backpack-tf.js';
import { csfloatProvider } from './csfloat.js';
import { playerDbProvider } from './playerdb.js';
import { steamApiProvider } from './steam-api.js';
import { steamInventoryProvider } from './steam-inventory.js';
import { steamXmlProvider } from './steam-xml.js';
import { steamDbProvider } from './steamdb.js';

/** All Steam lookup providers */
const ALL_STEAM_PROVIDERS: Provider[] = [
  playerDbProvider,
  steamXmlProvider,
  steamApiProvider,
  steamInventoryProvider,
  backpackTfProvider,
  csfloatProvider,
  steamDbProvider,
];

/**
 * Orchestrated Steam Lookup.
 * Resolves profile, queries official APIs, XML community feeds, inventory, external trading/DB services,
 * calculates SteamID formats locally, and appends external links.
 */
export function lookupSteam(
  query: string,
  type?: LookupType,
  originalQuery?: string,
): DualPromiseResult {
  const providers = filterAndSortProviders(ALL_STEAM_PROVIDERS, config.providersSteam);

  return executeProvidersBackground(providers, query, type, originalQuery);
}
