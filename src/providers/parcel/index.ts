import { config } from '../../config.js';
import { executeProvidersBackground, filterAndSortProviders, type DualPromiseResult } from '../../lib/providers.js';
import type { LookupType, Provider, } from '../../types/common.js';
import { bingProvider, duckduckgoProvider, googleProvider, yahooProvider } from '../web/index.js';
import { seventeenTrack } from './17track.js';
import { dhl } from './dhl.js';
import { dhlWeb } from './dhl-web.js';
import { parcelsapp } from './parcelsapp.js';
import { pkge } from './pkge.js';

const ALL_PROVIDERS: Provider[] = [
  dhlWeb,
  dhl,
  parcelsapp,
  pkge,
  seventeenTrack,
  googleProvider,
  bingProvider,
  duckduckgoProvider,
  yahooProvider,
];

export function lookupParcel(query: string, type?: LookupType): DualPromiseResult {
  const providers = filterAndSortProviders(ALL_PROVIDERS, config.providersParcel);

  return executeProvidersBackground(providers, query, type);
}
