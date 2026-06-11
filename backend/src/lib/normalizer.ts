import { resolve4 } from 'node:dns/promises';
import { isIP } from 'node:net';
import { config } from '../config.js';
import type { LookupType } from '../types/common.js';

/**
 * Special numbers that skip standard normalization and return hardcoded data.
 */
export const SPECIAL_NUMBERS: Record<string, { name: string; number_type: string }> = {
  '110': { name: 'Polizei Notruf', number_type: 'emergency' },
  '112': { name: 'Feuerwehr Notruf', number_type: 'emergency' },
  '911': { name: 'Notruf', number_type: 'emergency' },
  '19222': { name: 'Krankentransport', number_type: 'emergency' },
};

/**
 * Normalize a phone number to a clean format.
 */
export function normalizeTel(input: string): string {
  const trimmed = input.trim().replace(/[\s\-.()/]/g, '');
  if (!trimmed) return '';

  // Skip normalization for special numbers
  if (trimmed in SPECIAL_NUMBERS) {
    return trimmed;
  }

  let cleaned = trimmed;

  // Short number completion logic:
  // If numeric and short (e.g. < 9 digits) and doesn't start with 0 or +,
  // prepend country + local prefix.
  if (
    /^\d+$/.test(cleaned) &&
    cleaned.length < 9 &&
    !cleaned.startsWith('0') &&
    !cleaned.startsWith('+')
  ) {
    cleaned = `${config.phoneCountryPrefix}${config.phoneLocalPrefix}${cleaned}`;
  }

  // Standard normalization
  if (cleaned.startsWith('+')) {
    cleaned = `00${cleaned.slice(1).replace(/\D/g, '')}`;
  } else {
    cleaned = cleaned.replace(/\D/g, '');
  }

  // Convert leading 0 (local format) to country prefix
  if (cleaned.startsWith('0') && !cleaned.startsWith('00') && cleaned.length > 3) {
    cleaned = `${config.phoneCountryPrefix}${cleaned.slice(1)}`;
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
  const cleaned = trimmed
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
export function normalizeLocation(input: string): {
  query: string;
  isCoords: boolean;
  lat?: number;
  lon?: number;
} {
  const trimmed = input.trim();

  // Try to parse as coordinates (lat,lon or lat lon)
  const coordPatterns = [
    /^(-?\d+\.?\d*)\s*[,;\s]\s*(-?\d+\.?\d*)$/, // "52.52, 13.40" or "52.52 13.40"
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
 * Normalize a domain name.
 * Strips protocol, path, and port.
 */
export function normalizeDomain(input: string): string {
  const trimmed = input.trim().toLowerCase();
  return trimmed
    .replace(/^(?:https?|ftp):\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/:.*$/, '');
}

/**
 * Normalize a Steam ID or profile URL to SteamID64 or vanity name.
 */
export function normalizeSteam(input: string): string {
  const trimmed = input.trim();

  // 1. Check if it's a Steam Community URL
  const idMatch = trimmed.match(/steamcommunity\.com\/profiles\/([0-9]+)/i);
  if (idMatch) {
    return idMatch[1];
  }

  const vanityMatch = trimmed.match(/steamcommunity\.com\/id\/([a-zA-Z0-9_-]+)/i);
  if (vanityMatch) {
    return vanityMatch[1];
  }

  // 2. Check if it's SteamID2 (e.g., STEAM_0:1:61786227)
  const id2Match = trimmed.match(/^STEAM_[0-5]:([0-1]):([0-9]+)$/i);
  if (id2Match) {
    const y = BigInt(id2Match[1]);
    const z = BigInt(id2Match[2]);
    const steamId64 = 76561197960265728n + z * 2n + y;
    return steamId64.toString();
  }

  // 3. Check if it's SteamID3 (e.g., [U:1:123572455])
  const id3Match = trimmed.match(/^\[U:[0-9]:([0-9]+)\]$/i);
  if (id3Match) {
    const w = BigInt(id3Match[1]);
    const steamId64 = 76561197960265728n + w;
    return steamId64.toString();
  }

  return trimmed;
}

export function isLikelyLocation(text: string): boolean {
  if (!text) return false;
  if (text.length > 50) return false; // Too long for a location name

  const lower = text.toLowerCase();
  const statusWords = [
    'package', 'parcel', 'may', 'not', 'have', 'been', 'sent', 'yet', 'pending',
    'information', 'status', 'delivery', 'carrier', 'your', 'order', 'arrived',
    'departed', 'transit', 'facility', 'sorted', 'processed', 'shipping', 'shipped',
    'delivered', 'handling', 'hub', 'courier', 'updates',
  ];

  let statusWordCount = 0;
  for (const word of statusWords) {
    if (lower.includes(word)) {
      statusWordCount++;
    }
  }

  // If it contains multiple status words or resembles a warning statement, it is a status text
  if (statusWordCount >= 2) return false;

  return true;
}

/**
 * Normalize a URL.
 */
export function normalizeUrl(input: string): string {
  let trimmed = input.trim();
  if (!trimmed) return '';

  if (!/^[a-zA-Z0-9+.-]+:\/\//.test(trimmed)) {
    trimmed = `https://${trimmed}`;
  }

  try {
    const parsed = new URL(trimmed);
    return parsed.toString();
  } catch {
    return trimmed;
  }
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
    case 'domain':
      return normalizeDomain(input);
    case 'email':
      return normalizeEmail(input);
    case 'location':
      return normalizeLocation(input).query;
    case 'parcel':
      return normalizeParcel(input);
    case 'steam':
      return normalizeSteam(input);
    case 'url':
      return normalizeUrl(input);
    case 'apk':
      return input.trim();
    default:
      return input.trim();
  }
}

/**
 * Automatically detect the likely lookup type for a query.
 */
export function detectType(query: string): LookupType {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return 'web';

  // 1. Steam Queries
  if (
    /steamcommunity\.com\/(id|profiles)\//i.test(trimmed) ||
    /^steam_[0-5]:[0-1]:[0-9]+$/i.test(trimmed) ||
    /^\[u:[0-9]:[0-9]+\]$/i.test(trimmed) ||
    /^7656119[0-9]{10}$/.test(trimmed)
  ) {
    return 'steam';
  }

  // 2. APK Providers
  if (
    /play\.google\.com\/store\/apps\/details/i.test(trimmed) ||
    /apkmirror\.com/i.test(trimmed) ||
    /apkpure\.com/i.test(trimmed) ||
    /aptoide\.com/i.test(trimmed) ||
    // Simple heuristic for Android package names (e.g., com.google.android.youtube)
    (/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+[0-9a-z_]$/i.test(trimmed) &&
      (trimmed.startsWith('com.') || trimmed.startsWith('net.') || trimmed.startsWith('org.')))
  ) {
    return 'apk';
  }

  // 3. Explicit URLs
  if (/^https?:\/\//i.test(trimmed)) {
    return 'url';
  }

  // 3. URL parsing or Domain Name
  const domainCandidate = trimmed
    .replace(/^(?:https?|ftp):\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/:.*$/, '');

  // 4. IP Address
  if (isIP(domainCandidate)) return 'ip';

  // 5. Email
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmed)) return 'email';

  // 6. Phone Number (best effort)
  // Starts with +, 00, or is just digits and long enough
  if (/^(\+|00|0)[0-9]{5,15}$/.test(trimmed.replace(/[\s\-.()/]/g, ''))) {
    return 'tel';
  }

  // 7. Domain Name
  // Matches something.tld or sub.something.tld
  if (
    /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/.test(
      domainCandidate,
    )
  ) {
    return 'domain';
  }

  // 8. Parcel (best effort, numeric and long)
  if (/^[0-9]{10,30}$/.test(trimmed)) {
    return 'parcel';
  }

  // Default fallback
  return 'web';
}
