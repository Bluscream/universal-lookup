import { describe, expect, it } from 'vitest';
import {
  executeProvidersBackground,
  filterAndSortProviders,
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

describe('filterAndSortProviders', () => {
  const all = [stub('alpha'), stub('beta'), stub('gamma')];

  it('returns every available provider when no selection is given', () => {
    expect(filterAndSortProviders(all, '').map((p) => p.name)).toEqual(['alpha', 'beta', 'gamma']);
    expect(filterAndSortProviders(all, undefined).map((p) => p.name)).toHaveLength(3);
  });

  it('drops providers that report themselves unavailable', () => {
    const withMissing = [stub('alpha'), stub('beta', { available: false })];
    expect(filterAndSortProviders(withMissing, '').map((p) => p.name)).toEqual(['alpha']);
    // Even when explicitly requested.
    expect(filterAndSortProviders(withMissing, 'beta,alpha').map((p) => p.name)).toEqual(['alpha']);
  });

  it('honours the order of the selection, not the registry order', () => {
    expect(filterAndSortProviders(all, 'gamma,alpha').map((p) => p.name)).toEqual([
      'gamma',
      'alpha',
    ]);
  });

  it('ignores unknown names and duplicates', () => {
    expect(filterAndSortProviders(all, 'alpha,nope,alpha').map((p) => p.name)).toEqual(['alpha']);
  });

  it('matches names whose punctuation has been stripped', () => {
    const punctuated = [stub('ip-api.com')];
    expect(filterAndSortProviders(punctuated, 'ipapicom').map((p) => p.name)).toEqual([
      'ip-api.com',
    ]);
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
