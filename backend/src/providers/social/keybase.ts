/**
 * Keybase's identity graph, read backwards.
 *
 * `user/lookup.json` takes a handle on one service and returns the Keybase user
 * who proved it, with every other proof they hold. That is exactly this lookup's
 * question, answered in one unauthenticated request, which is why there is no
 * client library here: the whole integration is a GET and a field rename.
 *
 * Two things to know about the data. Keybase has been in maintenance since
 * Zoom acquired it in 2020, so the graph is real but stopped growing — a miss
 * means nothing, and a fair number of Twitter proofs now 404 because the
 * proving tweet was deleted. And `proofs_summary` is Keybase's own assertion
 * that it checked the proof; the signatures are independently verifiable via
 * `sig_id`, but nothing here does that, so `verified_by` names Keybase rather
 * than claiming cryptographic certainty this provider did not establish.
 */

import type { LookupType, Provider, ProviderResult, SocialAccount } from '../../types/common.js';
import {
  canonicalPlatform,
  type DiscoveryData,
  discovered,
  failure,
  get,
  normalizeHandle,
} from './shared.js';

const NAME = 'keybase';
const LOOKUP_URL = 'https://keybase.io/_/api/1.0/user/lookup.json';

/**
 * The query parameters Keybase accepts for a reverse lookup, in the order they
 * are tried. Probed against the live API: everything here resolves a handle to a
 * user, while `mastodon`, `email`, `bitcoin` and `pgp_fingerprint` are rejected
 * with MISSING_PARAMETER and so are deliberately absent.
 *
 * `usernames` is first because a Keybase username is the cheapest hit, then the
 * services in rough order of how likely a given handle belongs to them.
 */
const REVERSE_KEYS = [
  'usernames',
  'github',
  'twitter',
  'reddit',
  'hackernews',
  'facebook',
  'coinbase',
] as const;

interface KeybaseProof {
  proof_type?: string;
  nametag?: string;
  service_url?: string;
  proof_url?: string;
  human_url?: string;
  sig_id?: string;
  state?: number;
}

interface KeybaseUser {
  basics?: { username?: string };
  proofs_summary?: { all?: KeybaseProof[] };
}

interface KeybaseResponse {
  status?: { code?: number; name?: string; desc?: string };
  them?: KeybaseUser | KeybaseUser[] | null;
}

/** `them` is a bare object for some keys and an array for others. */
function users(response: KeybaseResponse): KeybaseUser[] {
  const them = response.them;
  if (!them) return [];
  return (Array.isArray(them) ? them : [them]).filter((u): u is KeybaseUser => Boolean(u));
}

/**
 * `state` is Keybase's verdict on the proof. 1 is a live, checked proof;
 * anything else means it failed its last check — commonly because the proving
 * post was deleted. Those are still reported, because the signature was once
 * valid and the link is still evidence, but they carry no verifier.
 */
function toAccount(proof: KeybaseProof): SocialAccount | null {
  const platform = proof.proof_type?.trim();
  const account = proof.nametag?.trim();
  if (!platform || !account) return null;
  return {
    platform: canonicalPlatform(platform),
    account,
    url: proof.service_url ?? null,
    sources: [NAME],
    verified_by: proof.state === 1 ? [NAME] : [],
    keybase_proof_url: proof.proof_url ?? proof.human_url ?? null,
  };
}

async function lookupBy(key: string, handle: string): Promise<KeybaseResponse> {
  return get<KeybaseResponse>(LOOKUP_URL, {
    params: { [key]: handle, fields: 'basics,proofs_summary' },
  });
}

async function lookup(
  query: string,
  _type?: LookupType,
  _originalQuery?: string,
): Promise<ProviderResult<DiscoveryData>> {
  const start = Date.now();
  const handle = normalizeHandle(query);
  try {
    // Sequential rather than parallel, and the loop stops at the first hit:
    // Keybase is a frozen free service and seven concurrent requests per lookup
    // is a poor way to treat one. The first match is authoritative anyway —
    // a handle resolving to two different Keybase users is not a case that
    // arises, because each proof is unique per service.
    for (const key of REVERSE_KEYS) {
      const response = await lookupBy(key, handle);
      const [user] = users(response);
      const username = user?.basics?.username;
      if (!username) continue;

      const accounts = (user.proofs_summary?.all ?? [])
        .map(toAccount)
        .filter((a): a is SocialAccount => a !== null);

      // The Keybase account itself is a social account, and the only one the
      // proofs never list.
      accounts.unshift({
        platform: 'keybase',
        account: username,
        url: `https://keybase.io/${username}`,
        sources: [NAME],
        verified_by: [NAME],
      });

      return discovered(NAME, start, handle, accounts, username, response);
    }
    return discovered(NAME, start, handle, [], undefined, undefined);
  } catch (error) {
    return failure(NAME, start, error);
  }
}

export const keybase: Provider = {
  name: NAME,
  lookup,
  // No credentials, no configuration: the endpoint is public and unauthenticated.
  isAvailable: () => true,
};
