import { describe, expect, it } from 'vitest';
import { config } from '../backend/src/config.js';
import {
  executeProvidersBackground,
  filterProviders,
  isBlacklisted,
  isTypeBlacklisted,
} from '../backend/src/lib/providers.js';
import type { Provider, ProviderResult } from '../backend/src/types/common.js';

function stub(name: string, opts: { available?: boolean; delayMs?: number } = {}): Provider {
  return {
    name,
    isAvailable: () => opts.available ?? true,
    async lookup(): Promise<ProviderResult> {
      if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
      return { provider: name, success: true, data: { who: name }, duration: 0 };
    },
  };
}

describe('filterProviders', () => {
  const all = [stub('alpha'), stub('beta'), stub('gamma')];

  /** Run `fn` with a given PROVIDERS_BLACKLIST, then restore it. */
  function withBlacklist<T>(list: string, fn: () => T): T {
    const original = config.providersBlacklist;
    config.providersBlacklist = list;
    try {
      return fn();
    } finally {
      config.providersBlacklist = original;
    }
  }

  it('returns every available provider when the blacklist is empty', () => {
    withBlacklist('', () => {
      expect(filterProviders(all, 'tel').map((p) => p.name)).toEqual(['alpha', 'beta', 'gamma']);
    });
  });

  it('drops providers that report themselves unavailable', () => {
    const withMissing = [stub('alpha'), stub('beta', { available: false })];
    withBlacklist('', () => {
      expect(filterProviders(withMissing, 'tel').map((p) => p.name)).toEqual(['alpha']);
    });
  });

  it('removes only the blacklisted names, keeping registry order', () => {
    withBlacklist('beta', () => {
      expect(filterProviders(all, 'tel').map((p) => p.name)).toEqual(['alpha', 'gamma']);
    });
  });

  it('tolerates whitespace, case and unknown names in the list', () => {
    withBlacklist(' BETA , nope,, ', () => {
      expect(filterProviders(all, 'tel').map((p) => p.name)).toEqual(['alpha', 'gamma']);
    });
  });

  it('matches names whose punctuation has been stripped, in either direction', () => {
    const punctuated = [stub('ip-api.com')];
    withBlacklist('ipapicom', () => {
      expect(filterProviders(punctuated, 'ip')).toEqual([]);
    });
    withBlacklist('ip-api.com', () => {
      expect(filterProviders(punctuated, 'ip')).toEqual([]);
    });
  });

  it('answers for things that are not providers, such as whole lookup types', () => {
    withBlacklist('web,steam-xml', () => {
      // A whole lookup type and a single sub-provider share the one list.
      expect(isTypeBlacklisted('web')).toBe(true);
      expect(isBlacklisted('steamxml')).toBe(true);
      expect(isTypeBlacklisted('tel')).toBe(false);
    });
  });

  it('lets a scope separate a name that means two things', () => {
    // 'steam' is both a lookup type and a provider in the status registry.
    withBlacklist('status:steam', () => {
      expect(isBlacklisted('steam', 'status')).toBe(true);
      expect(isTypeBlacklisted('steam')).toBe(false);
    });
    withBlacklist('type:steam', () => {
      expect(isTypeBlacklisted('steam')).toBe(true);
      expect(isBlacklisted('steam', 'status')).toBe(false);
    });
    // Unscoped still hits both, which is the common intent.
    withBlacklist('steam', () => {
      expect(isTypeBlacklisted('steam')).toBe(true);
      expect(isBlacklisted('steam', 'status')).toBe(true);
    });
  });

  it('runs nothing at all for a blacklisted lookup type', () => {
    // Defence in depth: the route refuses the type too, but an internal caller
    // (auto falling back to web) must not fan out to a disabled type either.
    withBlacklist('tel', () => {
      expect(filterProviders(all, 'tel')).toEqual([]);
      expect(filterProviders(all, 'ip').map((p) => p.name)).toHaveLength(3);
    });
  });

  it('scopes a provider to its own registry', () => {
    withBlacklist('tel:beta', () => {
      expect(filterProviders(all, 'tel').map((p) => p.name)).toEqual(['alpha', 'gamma']);
      expect(filterProviders(all, 'ip').map((p) => p.name)).toEqual(['alpha', 'beta', 'gamma']);
    });
  });
});

describe('executeProvidersBackground', () => {
  it('returns each provider result', async () => {
    const { clientPromise, serverPromise } = executeProvidersBackground(
      [stub('alpha'), stub('beta')],
      'q',
    );

    expect((await clientPromise).map((r) => r.provider).sort()).toEqual(['alpha', 'beta']);
    expect((await serverPromise).every((r) => r.success)).toBe(true);
  });

  it('does not keep the event loop alive once every provider has answered', async () => {
    // Regression: the timeout timers in both races were never cleared, so a
    // finished lookup still held a handle open for the full SERVER_TIMEOUT.
    const before = process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length;

    const { clientPromise, serverPromise } = executeProvidersBackground([stub('alpha')], 'q');
    await clientPromise;
    await serverPromise;

    const after = process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length;
    expect(after).toBeLessThanOrEqual(before);
  });

  it('reports a provider that throws as a failure instead of rejecting', async () => {
    const exploding: Provider = {
      name: 'boom',
      isAvailable: () => true,
      lookup: () => Promise.reject(new Error('provider exploded')),
    };

    const { serverPromise } = executeProvidersBackground([exploding], 'q');
    const [result] = await serverPromise;

    expect(result.success).toBe(false);
    expect(result.error).toBe('provider exploded');
  });
});
