import {
  type DualPromiseResult,
  executeProvidersBackground,
  filterProviders,
} from '../../lib/providers.js';
import type { LookupType, Provider } from '../../types/common.js';
import { provider11880 } from './11880.js';
import { dasoertliche } from './dasoertliche.js';
import { dastelefonbuch } from './dastelefonbuch.js';
import { emergencyProvider } from './emergency.js';
import { fritzbox } from './fritzbox.js';
import { phoneblock } from './phoneblock.js';
import { tellows } from './tellows.js';

const ALL_PROVIDERS: Provider[] = [
  emergencyProvider,
  fritzbox,
  tellows,
  phoneblock,
  dastelefonbuch,
  provider11880,
  dasoertliche,
];

export function lookupTel(query: string, type?: LookupType): DualPromiseResult {
  const providers = filterProviders(ALL_PROVIDERS, 'tel');

  return executeProvidersBackground(providers, query, type);
}

/** Every provider registered for this lookup type, in registry order. */
export const PROVIDERS = ALL_PROVIDERS;

/** Names of every provider registered for this lookup type. */
export const PROVIDER_NAMES: string[] = PROVIDERS.map((p) => p.name);
