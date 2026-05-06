import { getDatabase } from '../db/migrations.js';

interface RateLimitState {
  remaining: number;
  resetAt: number; // Unix timestamp
  limitTotal: number;
}

/** In-memory rate limit cache for fast checks */
const memoryCache = new Map<string, RateLimitState>();

/**
 * Update rate limit state for a provider from response headers.
 */
export function updateRateLimit(
  provider: string,
  headers: Record<string, string | string[] | undefined>,
): void {
  const remaining = parseHeaderInt(
    headers['x-ratelimit-remaining'] ?? headers['x-rate-limit-remaining'],
  );
  const limit = parseHeaderInt(headers['x-ratelimit-limit'] ?? headers['x-rate-limit-limit']);
  const reset = parseHeaderInt(
    headers['x-ratelimit-reset'] ?? headers['x-rate-limit-reset'] ?? headers['retry-after'],
  );

  if (remaining === null && limit === null && reset === null) return;

  const state: RateLimitState = {
    remaining: remaining ?? 999,
    resetAt: reset ? (reset < 100000 ? Math.floor(Date.now() / 1000) + reset : reset) : 0,
    limitTotal: limit ?? 0,
  };

  memoryCache.set(provider, state);

  // Persist to DB
  try {
    const db = getDatabase();
    db.run(
      `INSERT INTO rate_limits (provider, remaining, reset_at, limit_total) VALUES (?, ?, ?, ?)
       ON CONFLICT(provider) DO UPDATE SET remaining = excluded.remaining, reset_at = excluded.reset_at, limit_total = excluded.limit_total`,
      [provider, state.remaining, state.resetAt, state.limitTotal],
    );
  } catch {
    // DB might not be ready yet, that's fine
  }
}

/**
 * Check if a provider is currently rate limited.
 * Returns the number of seconds to wait, or 0 if not limited.
 */
export function isRateLimited(provider: string): number {
  const state = memoryCache.get(provider);
  if (!state) return 0;

  const now = Math.floor(Date.now() / 1000);

  // If we've passed the reset time, clear the limit
  if (state.resetAt > 0 && now >= state.resetAt) {
    memoryCache.delete(provider);
    return 0;
  }

  // If remaining is 0, we're rate limited
  if (state.remaining <= 0 && state.resetAt > now) {
    return state.resetAt - now;
  }

  return 0;
}

/**
 * Decrement the remaining count for a provider.
 */
export function decrementRateLimit(provider: string): void {
  const state = memoryCache.get(provider);
  if (state && state.remaining > 0) {
    state.remaining--;
  }
}

function parseHeaderInt(value: string | string[] | undefined): number | null {
  if (!value) return null;
  const str = Array.isArray(value) ? value[0] : value;
  const num = parseInt(str, 10);
  return Number.isNaN(num) ? null : num;
}
