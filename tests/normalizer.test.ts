import { describe, expect, it } from 'vitest';
import {
  normalizeEmail,
  normalizeLocation,
  normalizeParcel,
  normalizeTel,
} from '../src/lib/normalizer.js';

describe('normalizeTel', () => {
  it('strips whitespace and dashes', () => {
    expect(normalizeTel('+49 30 123 456')).toBe('+4930123456');
    expect(normalizeTel('+49-30-123-456')).toBe('+4930123456');
  });

  it('strips parentheses and dots', () => {
    expect(normalizeTel('(030) 123.456')).toBe('+4930123456');
  });

  it('converts 0049 to +49', () => {
    expect(normalizeTel('004930123456')).toBe('+4930123456');
  });

  it('converts leading 0 to +49', () => {
    expect(normalizeTel('030123456')).toBe('+4930123456');
  });

  it('preserves + prefix', () => {
    expect(normalizeTel('+4930123456')).toBe('+4930123456');
  });

  it('handles international format', () => {
    expect(normalizeTel('+1 555 123 4567')).toBe('+15551234567');
  });

  it('handles slashes', () => {
    expect(normalizeTel('030/123456')).toBe('+4930123456');
  });
});

describe('normalizeEmail', () => {
  it('lowercases and trims', () => {
    expect(normalizeEmail('  User@EXAMPLE.COM  ')).toBe('user@example.com');
  });

  it('handles normal emails', () => {
    expect(normalizeEmail('john.doe@gmail.com')).toBe('john.doe@gmail.com');
  });
});

describe('normalizeParcel', () => {
  it('strips whitespace and uppercases', () => {
    expect(normalizeParcel('0034 0434 5153 1059 6216')).toBe('00340434515310596216');
  });

  it('uppercases tracking numbers', () => {
    expect(normalizeParcel('jd014600007776756818')).toBe('JD014600007776756818');
  });
});

describe('normalizeLocation', () => {
  it('detects coordinates with comma', () => {
    const result = normalizeLocation('52.52, 13.40');
    expect(result.isCoords).toBe(true);
    expect(result.lat).toBeCloseTo(52.52);
    expect(result.lon).toBeCloseTo(13.4);
  });

  it('detects coordinates with space', () => {
    const result = normalizeLocation('52.52 13.40');
    expect(result.isCoords).toBe(true);
    expect(result.lat).toBeCloseTo(52.52);
  });

  it('handles place names', () => {
    const result = normalizeLocation('Berlin, Germany');
    expect(result.isCoords).toBe(false);
    expect(result.query).toBe('Berlin, Germany');
  });

  it('handles negative coordinates', () => {
    const result = normalizeLocation('-33.8688, 151.2093');
    expect(result.isCoords).toBe(true);
    expect(result.lat).toBeCloseTo(-33.8688);
    expect(result.lon).toBeCloseTo(151.2093);
  });
});
