import { config } from '../../config.js';
import {
  type DualPromiseResult,
  executeProvidersBackground,
  filterAndSortProviders,
} from '../../lib/providers.js';
import type { LookupType, Provider } from '../../types/common.js';
import { bingProvider, duckduckgoProvider, googleProvider, yahooProvider } from '../web/index.js';
import { seventeenTrack } from './17track.js';
import { amazonTba } from './amazon-tba.js';
import { dhl } from './dhl.js';
import { dhlWeb } from './dhl-web.js';
import { fedex } from './fedex.js';
import { parcelsapp } from './parcelsapp.js';
import { pkge } from './pkge.js';
import { ups } from './ups.js';
import { usps } from './usps.js';

const ALL_PROVIDERS: Provider[] = [
  amazonTba,
  dhlWeb,
  dhl,
  usps,
  ups,
  fedex,
  parcelsapp,
  pkge,
  seventeenTrack,
  googleProvider,
  bingProvider,
  duckduckgoProvider,
  yahooProvider,
];

export function lookupParcel(
  query: string,
  type?: LookupType,
  options?: { postalCode?: string },
): DualPromiseResult {
  const providers = filterAndSortProviders(ALL_PROVIDERS, config.providersParcel);

  return executeProvidersBackground(providers, query, type, undefined, options);
}
