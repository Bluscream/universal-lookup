import { config } from '../../config.js';
import {
  type DualPromiseResult,
  executeProvidersBackground,
  filterAndSortProviders,
} from '../../lib/providers.js';
import type { LookupType, Provider } from '../../types/common.js';
import { bingProvider, duckduckgoProvider, googleProvider, yahooProvider } from '../web/index.js';
import { provider11880 } from './11880.js';
import { dasoertliche } from './dasoertliche.js';
import { dastelefonbuch } from './dastelefonbuch.js';
import { emergencyProvider } from './emergency.js';
import { fritzbox } from './fritzbox.js';
import { tellows } from './tellows.js';

const ALL_PROVIDERS: Provider[] = [
  emergencyProvider,
  fritzbox,
  tellows,
  dastelefonbuch,
  provider11880,
  dasoertliche,
  googleProvider,
  bingProvider,
  duckduckgoProvider,
  yahooProvider,
];

export function lookupTel(query: string, type?: LookupType): DualPromiseResult {
  const providers = filterAndSortProviders(ALL_PROVIDERS, config.providersTel);

  return executeProvidersBackground(providers, query, type);
}
