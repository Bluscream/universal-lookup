/**
 * A per-key circuit breaker for expensive, repeatedly-failing operations.
 *
 * The case this exists for: every allestörungen page fetch was failing with a
 * navigation timeout, and nothing remembered that. Each request paid the full
 * cost again — roughly a minute of headless-Chromium CPU per page, forever, on
 * a container capped at 512 MB. A provider that has failed several times in a
 * row is almost certainly still broken, so stop asking it for a while.
 *
 * Deliberately not a full three-state breaker: after the cooldown the next call
 * is simply allowed through, and one success resets the count. That is enough
 * here and leaves nothing to tune.
 */

interface BreakerState {
  failures: number;
  /** When the circuit opened; undefined while it is closed. */
  openedAt?: number;
}

export interface CircuitBreakerOptions {
  /** Consecutive failures before the circuit opens. */
  threshold: number;
  /** How long it stays open, in milliseconds. */
  cooldownMs: number;
}

export class CircuitBreaker {
  private readonly states = new Map<string, BreakerState>();

  constructor(
    private readonly name: string,
    private readonly options: CircuitBreakerOptions,
  ) {}

  /** True when `key` is currently being skipped. */
  isOpen(key: string): boolean {
    const state = this.states.get(key);
    if (!state?.openedAt) return false;

    if (Date.now() - state.openedAt >= this.options.cooldownMs) {
      // Cooldown elapsed: let the next call through to find out.
      state.openedAt = undefined;
      state.failures = 0;
      return false;
    }
    return true;
  }

  /** Milliseconds until `key` is retried, or 0 when it is not being skipped. */
  retryInMs(key: string): number {
    const state = this.states.get(key);
    if (!state?.openedAt) return 0;
    return Math.max(0, this.options.cooldownMs - (Date.now() - state.openedAt));
  }

  /** Record a failure, opening the circuit once the threshold is reached. */
  recordFailure(key: string, reason?: string): void {
    const state = this.states.get(key) ?? { failures: 0 };
    state.failures++;
    if (state.failures >= this.options.threshold && !state.openedAt) {
      state.openedAt = Date.now();
      console.warn(
        `⚡ ${this.name}: circuit open for ${key} after ${state.failures} failures` +
          ` — skipping for ${Math.round(this.options.cooldownMs / 1000)}s` +
          (reason ? ` (last: ${reason})` : ''),
      );
    }
    this.states.set(key, state);
  }

  /** Record a success, clearing any accumulated failures. */
  recordSuccess(key: string): void {
    const state = this.states.get(key);
    if (!state) return;
    if (state.openedAt) {
      console.log(`⚡ ${this.name}: circuit closed for ${key} — recovered`);
    }
    this.states.delete(key);
  }

  /** Drop all state. Tests, and the cache-clearing paths that reset a provider. */
  reset(): void {
    this.states.clear();
  }
}
