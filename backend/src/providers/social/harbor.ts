/**
 * Harbor / Polycentric's verification claims, read backwards.
 *
 * Harbor is the live half of this lookup: unlike Keybase it is still growing,
 * and it covers the platforms Keybase never did — YouTube, Twitch, Discord,
 * Rumble. The reverse lookup is two gRPC calls (resolve the identity from a
 * claim, then list that identity's other claims), which `harbor-lookup` does;
 * this file is the adapter, not the protocol.
 *
 * The verifier is the part worth understanding. `ListVerificationClaims` takes
 * no verifier argument, so the server will happily return an identity's
 * self-asserted claims alongside vouched-for ones. `harbor-lookup` filters both
 * halves against a pinned trust root client-side, and `verified_by` below
 * carries whichever identities actually signed — so an unvouched claim arrives
 * with an empty list rather than silently inheriting the trust of its neighbours.
 */

import { Harbor, HARBOR_SEED_SERVERS, type Social, type SocialQuery } from 'harbor-lookup';
import type { LookupType, Provider, ProviderResult, SocialAccount } from '../../types/common.js';
import {
  canonicalPlatform,
  type DiscoveryData,
  discovered,
  failure,
  looksLikeId,
  normalizeHandle,
} from './shared.js';

const NAME = 'harbor';

/**
 * One client, reused.
 *
 * It holds a grpc-web transport per server and no per-request state, and
 * building one per lookup would discard connection reuse across the two calls
 * every lookup makes. Defaults are the package's: both seed servers, with
 * failover, and Harbor's own pinned verifier identity as the trust root.
 */
const harborClient = new Harbor();

function toAccount(social: Social): SocialAccount {
  return {
    platform: canonicalPlatform(social.platform),
    account: social.account ?? null,
    account_id: social.accountId ?? null,
    url: social.url ?? null,
    sources: [NAME],
    // Copied rather than aliased: harbor-lookup hands back a readonly array and
    // the accounts here are merged into afterwards.
    verified_by: [...social.verifiedBy],
    display_name: social.platformName,
  };
}

/**
 * The queries to try, in order, stopping at the first that resolves.
 *
 * Harbor matches claim fields by containment, so a bare `{ account }` with no
 * platform already searches every platform at once — verified live, and the
 * reason this is not a fan-out over all eight slugs. The fallbacks exist for the
 * two shapes a bare handle misses: YouTube records its handles with the leading
 * '@' kept, and a channel id or numeric id is an `account_id`, never an
 * `account`.
 */
function queriesFor(handle: string): SocialQuery[] {
  if (looksLikeId(handle)) return [{ accountId: handle }, { account: handle }];
  return [{ account: handle }, { account: `@${handle}` }, { accountId: handle }];
}

async function lookup(
  query: string,
  _type?: LookupType,
  _originalQuery?: string,
): Promise<ProviderResult<DiscoveryData>> {
  const start = Date.now();
  const handle = normalizeHandle(query);
  try {
    for (const attempt of queriesFor(handle)) {
      const groups = await harborClient.linkedIdentities(attempt);
      if (groups.length === 0) continue;

      // Several identities can claim the same handle on different platforms —
      // two unrelated people both called `dave`, say. All of them are reported;
      // deciding between them is the caller's business, and `identities` in the
      // response says how many there were.
      const accounts = groups.flatMap((group) => group.socials.map(toAccount));
      const identity = groups.map((group) => group.identity).join(',');
      return discovered(NAME, start, handle, accounts, identity, groups);
    }
    return discovered(NAME, start, handle, [], undefined, undefined);
  } catch (error) {
    return failure(NAME, start, error);
  }
}

export const harbor: Provider = {
  name: NAME,
  lookup,
  // Public servers, no credentials. Unavailable only if an operator emptied the
  // server list, which would make every call fail with the same error.
  isAvailable: () => HARBOR_SEED_SERVERS.length > 0,
};
