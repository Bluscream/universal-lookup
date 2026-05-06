import type { LookupType } from '../types/common.js';
import { isIP } from 'node:net';
import { resolve4 } from 'node:dns/promises';

/**
 * Normalize a phone number to a clean format.
 * Strips whitespace, dashes, parentheses, dots.
 * Converts common German prefixes.
 */
export function normalizeTel(input: string): string {
  // Strip common noise characters
  let cleaned = input.replace(/[\s\-\.\(\)\/]/g, '');

  // Remove any non-digit characters except leading +
  if (cleaned.startsWith('+')) {
    cleaned = '+' + cleaned.slice(1).replace(/\D/g, '');
  } else {
    cleaned = cleaned.replace(/\D/g, '');
  }

  // Convert +49 prefix to 0049
  if (cleaned.startsWith('+49')) {
    cleaned = '0049' + cleaned.slice(3);
  }
  // Convert +XX prefix to 00XX
  else if (cleaned.startsWith('+')) {
    cleaned = '00' + cleaned.slice(1);
  }
  // Already 0049 — keep as is
  else if (cleaned.startsWith('0049')) {
    // noop
  }
  // Convert 00XX prefix — keep as is
  else if (cleaned.startsWith('00') && cleaned.length > 4) {
    // noop
  }
  // Convert leading 0 (German local format) to 0049
  else if (cleaned.startsWith('0') && cleaned.length > 3) {
    cleaned = '0049' + cleaned.slice(1);
  }

  return cleaned;
}

/**
 * Normalize an IP address or domain.
 * Validates format, optionally resolves domains.
 */
export async function normalizeIp(input: string): Promise<string> {
  const trimmed = input.trim().toLowerCase();

  // Strip protocol if present
  let cleaned = trimmed
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/:.*$/, ''); // remove port

  // If it's already a valid IP, return as-is
  if (isIP(cleaned)) {
    return cleaned;
  }

  // Try to resolve domain to IP
  try {
    const addresses = await resolve4(cleaned);
    if (addresses.length > 0) {
      return cleaned; // Return the domain - providers can resolve as needed
    }
  } catch {
    // Not resolvable, return as-is and let providers handle it
  }

  return cleaned;
}

/**
 * Normalize an email address.
 */
export function normalizeEmail(input: string): string {
  return input.trim().toLowerCase();
}

/**
 * Normalize a location query.
 * Detects coordinates vs place names.
 */
export function normalizeLocation(input: string): { query: string; isCoords: boolean; lat?: number; lon?: number } {
  const trimmed = input.trim();

  // Try to parse as coordinates (lat,lon or lat lon)
  const coordPatterns = [
    /^(-?\d+\.?\d*)\s*[,;\s]\s*(-?\d+\.?\d*)$/,  // "52.52, 13.40" or "52.52 13.40"
    /^lat[=:]?\s*(-?\d+\.?\d*)\s*[,;&]\s*lo?ng?[=:]?\s*(-?\d+\.?\d*)$/i, // "lat=52.52,lng=13.40"
  ];

  for (const pattern of coordPatterns) {
    const match = trimmed.match(pattern);
    if (match) {
      const lat = parseFloat(match[1]);
      const lon = parseFloat(match[2]);
      if (lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
        return { query: `${lat},${lon}`, isCoords: true, lat, lon };
      }
    }
  }

  // It's a place name
  return { query: trimmed, isCoords: false };
}

/**
 * Normalize a parcel tracking number.
 */
export function normalizeParcel(input: string): string {
  // Strip whitespace, uppercase
  return input.replace(/\s+/g, '').toUpperCase();
}

/**
 * Normalize input based on lookup type.
 * Returns the normalized query string.
 */
export async function normalizeQuery(type: LookupType, input: string): Promise<string> {
  switch (type) {
    case 'tel':
      return normalizeTel(input);
    case 'ip':
      return normalizeIp(input);
    case 'email':
      return normalizeEmail(input);
    case 'location':
      return normalizeLocation(input).query;
    case 'parcel':
      return normalizeParcel(input);
    default:
      return input.trim();
  }
}
