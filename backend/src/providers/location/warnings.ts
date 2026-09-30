import type { LocationWarning, WarningSeverity } from '../../types/common.js';

/** Highest severity first, so `worstSeverity` can rank without a lookup table. */
const ORDER: WarningSeverity[] = ['extreme', 'severe', 'moderate', 'minor', 'unknown'];

/**
 * CAP severity onto the canonical scale.
 *
 * Both DWD and NINA publish CAP, so this is a case fold rather than a mapping:
 * anything unrecognised becomes 'unknown' rather than being guessed at, because
 * under-reporting a warning is worse than admitting we cannot rank it.
 */
export function capSeverity(value: string | undefined | null): WarningSeverity {
  switch ((value ?? '').trim().toLowerCase()) {
    case 'extreme':
      return 'extreme';
    case 'severe':
      return 'severe';
    case 'moderate':
      return 'moderate';
    case 'minor':
      return 'minor';
    default:
      return 'unknown';
  }
}

/** The most severe entry's severity, or undefined for an empty list. */
export function worstSeverity(warnings: LocationWarning[]): WarningSeverity | undefined {
  if (warnings.length === 0) return undefined;
  const present = new Set(warnings.map((w) => w.severity ?? 'unknown'));
  return ORDER.find((s) => present.has(s));
}

/** Drop keys a provider had nothing for, so merged output carries no nulls. */
export function tidyWarning(warning: LocationWarning): LocationWarning {
  return Object.fromEntries(
    Object.entries(warning).filter(([, v]) => v !== undefined && v !== null && v !== ''),
  ) as LocationWarning;
}
