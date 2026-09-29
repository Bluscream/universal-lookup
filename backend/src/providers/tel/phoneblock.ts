import axios from 'axios';
import { config } from '../../config.js';
import type { LookupType, Provider, ProviderResult, TelData } from '../../types/common.js';

const PROVIDER_NAME = 'phoneblock';

const API_BASE = 'https://phoneblock.net/phoneblock/api';

/**
 * PhoneBlock's community rating codes, ordered A (legitimate) to G (fraud).
 * The prefix letter carries the ordering, so the raw code sorts correctly.
 */
const RATING_LABELS = {
  A_LEGITIMATE: 'Legitimate',
  B_MISSED: 'Missed call',
  C_PING: 'Ping call',
  D_POLL: 'Poll / survey',
  E_ADVERTISING: 'Advertising',
  F_GAMBLE: 'Gambling',
  G_FRAUD: 'Fraud',
} as const;

type RatingCode = keyof typeof RATING_LABELS;

function isRatingCode(value: string): value is RatingCode {
  return value in RATING_LABELS;
}

/** The API reports "never" as 0 rather than null on its epoch-millisecond fields. */
function toIsoDate(epochMillis: unknown): string | undefined {
  if (typeof epochMillis !== 'number' || epochMillis <= 0) return undefined;
  const date = new Date(epochMillis);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

interface PhoneBlockInfo {
  phone?: string;
  votes?: number;
  votesWildcard?: number;
  rating?: string;
  whiteListed?: boolean;
  blackListed?: boolean;
  dateAdded?: number;
  lastUpdate?: number;
  label?: string | null;
  location?: string | null;
  userComment?: string | null;
  heat?: number;
  spamConfidence?: number;
  calls?: number;
}

export const phoneblock: Provider = {
  name: PROVIDER_NAME,
  isAvailable() {
    // The number-info endpoint is public; an API key only adds personal list data.
    return true;
  },

  async lookup(query: string, _type?: LookupType): Promise<ProviderResult<TelData>> {
    const start = Date.now();
    try {
      // Query is already normalized to 0049xxx, which the API accepts as
      // international format without needing the '+' percent-encoded.
      const url = `${API_BASE}/num/${encodeURIComponent(query)}`;
      const headers: Record<string, string> = { Accept: 'application/json' };
      // An API key is the provider's preferred scheme; username/password is
      // deprecated upstream, so it is only used when no key is configured.
      if (config.phoneblockApiKey) {
        headers.Authorization = `Bearer ${config.phoneblockApiKey}`;
      }
      const basicAuth =
        !config.phoneblockApiKey && config.phoneblockUser && config.phoneblockPassword
          ? { username: config.phoneblockUser, password: config.phoneblockPassword }
          : undefined;

      const resp = await axios.get<PhoneBlockInfo>(url, {
        timeout: config.serverTimeout,
        headers,
        ...(basicAuth ? { auth: basicAuth } : {}),
      });
      const raw = resp.data;

      if (!raw || typeof raw !== 'object') {
        return {
          provider: PROVIDER_NAME,
          success: false,
          data: {},
          raw,
          error: 'No data returned',
          duration: Date.now() - start,
        };
      }

      const rating = typeof raw.rating === 'string' ? raw.rating : undefined;
      const data: TelData = {
        // Shared fields, so they merge with whatever other providers found.
        phone_formatted: raw.label ?? undefined,
        caller_type: rating && isRatingCode(rating) ? RATING_LABELS[rating] : undefined,
        spam_score: raw.spamConfidence,
        blocklisted: raw.blackListed,
        whitelisted: raw.whiteListed,
        first_report: toIsoDate(raw.dateAdded),
        last_report: toIsoDate(raw.lastUpdate),
        calls_count: raw.calls,
        user_comment: raw.userComment ?? undefined,
        // Documented as city or region, but the API returns the carrier in
        // practice, so it is not safe to merge into either `city` or `provider`.
        phoneblock_location: raw.location ?? undefined,
        // PhoneBlock's own scales, which no other provider shares — the raw
        // A_LEGITIMATE..G_FRAUD code, a decay-weighted vote equivalent with a
        // four-month half-life, the same for the surrounding number range, and
        // a reports-per-day rate. Kept under the provider's name for the same
        // reason tellows_score is.
        phoneblock_rating: rating,
        phoneblock_votes: raw.votes,
        phoneblock_votes_wildcard: raw.votesWildcard,
        phoneblock_heat: raw.heat,
      };

      return {
        provider: PROVIDER_NAME,
        success: true,
        data,
        raw,
        duration: Date.now() - start,
      };
    } catch (error) {
      // A malformed number answers 400 with a plain-text body rather than JSON.
      if (axios.isAxiosError(error) && error.response?.status === 400) {
        return {
          provider: PROVIDER_NAME,
          success: false,
          data: {},
          raw: error.response.data,
          error: 'Invalid phone number',
          duration: Date.now() - start,
        };
      }
      return {
        provider: PROVIDER_NAME,
        success: false,
        data: {},
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - start,
      };
    }
  },
};
