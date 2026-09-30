import {
  type DualPromiseResult,
  executeProvidersBackground,
  filterProviders,
} from '../../lib/providers.js';
import type { LookupType, Provider } from '../../types/common.js';
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
];

export function lookupParcel(
  query: string,
  type?: LookupType,
  originalQuery?: string,
  options?: { postalCode?: string },
): DualPromiseResult {
  const providers = filterProviders(ALL_PROVIDERS, 'parcel');

  return executeProvidersBackground(providers, query, type, originalQuery, options);
}

/** Every provider registered for this lookup type, in registry order. */
export const PROVIDERS = ALL_PROVIDERS;

/** Names of every provider registered for this lookup type. */
export const PROVIDER_NAMES: string[] = PROVIDERS.map((p) => p.name);
