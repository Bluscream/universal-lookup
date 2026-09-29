import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CircuitBreaker } from '../backend/src/lib/circuit-breaker.js';

describe('CircuitBreaker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const make = () => new CircuitBreaker('test', { threshold: 3, cooldownMs: 60_000 });

  it('stays closed below the failure threshold', () => {
    const cb = make();
    cb.recordFailure('k');
    cb.recordFailure('k');
    expect(cb.isOpen('k')).toBe(false);
  });

  it('opens once consecutive failures reach the threshold', () => {
    const cb = make();
    for (let i = 0; i < 3; i++) cb.recordFailure('k');
    expect(cb.isOpen('k')).toBe(true);
    expect(cb.retryInMs('k')).toBe(60_000);
  });

  it('keeps keys independent, so one broken host does not skip another', () => {
    const cb = make();
    for (let i = 0; i < 3; i++) cb.recordFailure('broken');
    expect(cb.isOpen('broken')).toBe(true);
    expect(cb.isOpen('fine')).toBe(false);
  });

  it('closes again once the cooldown has elapsed', () => {
    const cb = make();
    for (let i = 0; i < 3; i++) cb.recordFailure('k');
    expect(cb.isOpen('k')).toBe(true);

    vi.advanceTimersByTime(59_999);
    expect(cb.isOpen('k')).toBe(true);

    vi.advanceTimersByTime(1);
    expect(cb.isOpen('k')).toBe(false);
    expect(cb.retryInMs('k')).toBe(0);
  });

  it('a success resets the failure count, so failures must be consecutive', () => {
    const cb = make();
    cb.recordFailure('k');
    cb.recordFailure('k');
    cb.recordSuccess('k');
    cb.recordFailure('k');
    cb.recordFailure('k');
    expect(cb.isOpen('k')).toBe(false);
  });

  it('reset() clears every key', () => {
    const cb = make();
    for (let i = 0; i < 3; i++) cb.recordFailure('k');
    cb.reset();
    expect(cb.isOpen('k')).toBe(false);
  });

  it('reports the reason it opened, so logs say what broke', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const cb = make();
    for (let i = 0; i < 3; i++) cb.recordFailure('k', 'Navigation timeout of 15000 ms exceeded');

    expect(warn).toHaveBeenCalledOnce();
    const line = warn.mock.calls[0][0] as string;
    expect(line).toContain('circuit open for k');
    expect(line).toContain('Navigation timeout');
  });
});
