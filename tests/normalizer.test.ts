import { describe, expect, it } from 'vitest';
import {
  detectType,
  normalizeEmail,
  normalizeLocation,
  normalizeParcel,
  normalizeSteam,
  normalizeTel,
  normalizeUrl,
} from '../backend/src/lib/normalizer.js';

describe('normalizeTel', () => {
  it('strips whitespace and dashes', () => {
    expect(normalizeTel('+49 30 123 456')).toBe('004930123456');
    expect(normalizeTel('+49-30-123-456')).toBe('004930123456');
  });

  it('strips parentheses and dots', () => {
    expect(normalizeTel('(030) 123.456')).toBe('004930123456');
  });

  it('converts 0049 to 0049', () => {
    expect(normalizeTel('004930123456')).toBe('004930123456');
  });

  it('converts leading 0 to 0049', () => {
    expect(normalizeTel('030123456')).toBe('004930123456');
  });

  it('converts + prefix to 00', () => {
    expect(normalizeTel('+4930123456')).toBe('004930123456');
  });

  it('handles international format', () => {
    expect(normalizeTel('+1 555 123 4567')).toBe('0015551234567');
  });

  it('handles slashes', () => {
    expect(normalizeTel('030/123456')).toBe('004930123456');
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

describe('normalizeSteam', () => {
  it('converts SteamID2 mathematically to SteamID64', () => {
    expect(normalizeSteam('STEAM_0:1:61786227')).toBe('76561198083838183');
  });

  it('converts SteamID3 mathematically to SteamID64', () => {
    expect(normalizeSteam('[U:1:123572455]')).toBe('76561198083838183');
  });

  it('extracts ID64 from Steam profiles URL', () => {
    expect(normalizeSteam('https://steamcommunity.com/profiles/76561198083838183')).toBe(
      '76561198083838183',
    );
  });

  it('extracts vanity name from Steam custom URL', () => {
    expect(normalizeSteam('https://steamcommunity.com/id/bluscream')).toBe('bluscream');
  });

  it('returns raw strings as-is', () => {
    expect(normalizeSteam('gabelogannewell')).toBe('gabelogannewell');
  });
});

describe('normalizeUrl', () => {
  it('prepends https if protocol is missing', () => {
    expect(normalizeUrl('github.com/Bluscream/universal-lookup')).toBe(
      'https://github.com/Bluscream/universal-lookup',
    );
  });

  it('preserves existing protocols', () => {
    expect(normalizeUrl('http://127.0.0.1:24010/health')).toBe('http://127.0.0.1:24010/health');
  });
});

describe('detectType', () => {
  it('auto-detects steam type', () => {
    expect(detectType('STEAM_0:1:61786227')).toBe('steam');
    expect(detectType('https://steamcommunity.com/id/bluscream/')).toBe('steam');
    expect(detectType('76561198083838183')).toBe('steam');
  });

  it('auto-detects url type', () => {
    expect(detectType('https://github.com/Bluscream')).toBe('url');
  });

  it('auto-detects apk type', () => {
    expect(detectType('https://play.google.com/store/apps/details?id=com.google.android.apps.authenticator2')).toBe('apk');
    expect(detectType('https://www.apkmirror.com/?post_type=app_release&searchtype=apk&s=com.google.android.youtube')).toBe('apk');
    expect(detectType('https://m.apkpure.com/search?q=net.wooga.junes')).toBe('apk');
    expect(detectType('https://ws75.aptoide.com/api/7/app/get?package_name=com.whatsapp')).toBe('apk');
    expect(detectType('com.google.android.apps.authenticator2')).toBe('apk');
  });
});
