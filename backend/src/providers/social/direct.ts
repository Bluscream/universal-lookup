/**
 * The last two rungs of the fallback chain: ask the platforms themselves.
 *
 * Stages 1–3 (Synchra, Keybase, Harbor) answer the question this lookup is
 * actually about — *who* linked these accounts together. When none of them has
 * heard of a handle the answer is otherwise empty, and something is still worth
 * saying: the handle may exist on the platforms anyway.
 *
 * That is a materially weaker claim and the code keeps it separate from the
 * stronger one rather than blending them:
 *
 *   - **Stage 4, exact handle.** `github.com/<handle>` exists. That is a fact
 *     about a handle, not about a person. Two unrelated people routinely hold
 *     the same handle on two platforms, so these accounts carry
 *     `verified_by: []` and `match: "exact-handle"`.
 *   - **Stage 5, search.** The platform's own search for the handle, first hit.
 *     Weaker still — the match is approximate — so it is off unless
 *     SOCIAL_DIRECT_SEARCH is set, and labelled `"search-result"`.
 *
 * Neither stage invents a link between the accounts it finds. It reports what
 * each platform holds under that name and lets the caller judge.
 */

import { config } from '../../config.js';
import { isBlacklisted } from '../../lib/providers.js';
import type { ProviderResult, SocialAccount } from '../../types/common.js';
import {
  type DiscoveryData,
  type Enricher,
  MATCH_EXACT_HANDLE,
  normalizeHandle,
} from './shared.js';

/** What a stage produced, with per-platform failures kept rather than thrown. */
export interface DirectResult {
  accounts: SocialAccount[];
  failures: ProviderResult<DiscoveryData>[];
}

function usable(enrichers: Enricher[]): Enricher[] {
  return enrichers.filter((enricher) => enricher.isAvailable() && !isBlacklisted(enricher.name));
}

function failed(
  enricher: Enricher,
  handle: string,
  start: number,
  error: unknown,
): ProviderResult<DiscoveryData> {
  return {
    provider: enricher.name,
    success: false,
    data: {},
    error: `${enricher.platform}/${handle}: ${
      error instanceof Error ? error.message : String(error)
    }`,
    duration: Date.now() - start,
  };
}

/**
 * Stage 4: the handle, taken literally, on every platform that can be read.
 *
 * `enrich` already distinguishes the two outcomes that matter — it stamps
 * `enriched_by` when the platform confirmed the account and leaves it alone when
 * the read came back as a miss — so an account is kept only when the platform
 * said it exists.
 */
export async function exactHandleMatches(
  enrichers: Enricher[],
  query: string,
): Promise<DirectResult> {
  const handle = normalizeHandle(query);
  const failures: ProviderResult<DiscoveryData>[] = [];

  const found = await Promise.all(
    usable(enrichers).map(async (enricher): Promise<SocialAccount | null> => {
      const start = Date.now();
      try {
        const account = await enricher.enrich({
          platform: enricher.platform,
          account: handle,
          sources: [enricher.name],
          verified_by: [],
        });
        if (account.enriched_by !== enricher.name) return null;
        return { ...account, match: MATCH_EXACT_HANDLE };
      } catch (error) {
        failures.push(failed(enricher, handle, start, error));
        return null;
      }
    }),
  );

  return { accounts: found.filter((a): a is SocialAccount => a !== null), failures };
}

/**
 * Stage 5: each platform's own search, first hit only.
 *
 * One hit per platform, deliberately. A search returns a ranked list of people
 * who are mostly not the one being asked about, and returning all of them would
 * bury the single plausible answer in noise — so the chain takes the top result
 * and stops, which is what "first user search result" means.
 */
export async function searchMatches(enrichers: Enricher[], query: string): Promise<DirectResult> {
  const handle = normalizeHandle(query);
  const failures: ProviderResult<DiscoveryData>[] = [];

  const found = await Promise.all(
    usable(enrichers)
      .filter((enricher) => enricher.search !== undefined)
      .map(async (enricher) => {
        const start = Date.now();
        try {
          const hits = await enricher.search?.(handle);
          return hits?.[0] ?? null;
        } catch (error) {
          failures.push(failed(enricher, handle, start, error));
          return null;
        }
      }),
  );

  return { accounts: found.filter((a): a is SocialAccount => a !== null), failures };
}

/** Whether stage 5 runs at all. */
export function searchFallbackEnabled(): boolean {
  return config.socialDirectSearch;
}
