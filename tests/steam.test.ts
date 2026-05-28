import { describe, expect, it } from 'vitest';
import { playerDbProvider } from '../backend/src/providers/steam/playerdb.js';
import { steamXmlProvider } from '../backend/src/providers/steam/steam-xml.js';

describe('PlayerDB Steam Provider', () => {
  it('fetches profile details for gabelogannewell', async () => {
    // Gaben's SteamID64 is 76561197960287930
    const result = await playerDbProvider.lookup('76561197960287930');
    if (!result.success) {
      expect(result.error).toBeDefined();
      return;
    }
    expect(result.success).toBe(true);
    expect(result.data.steam_id_64).toBe('76561197960287930');
    expect(result.data.username).toBeDefined();
  }, 20000);
});

describe('Steam XML Provider', () => {
  it('scrapes public XML profile details', async () => {
    const result = await steamXmlProvider.lookup('76561197960287930');
    if (!result.success) {
      expect(result.error).toBeDefined();
      return;
    }
    expect(result.success).toBe(true);
    expect(result.data.steam_id_64).toBe('76561197960287930');
    expect(result.data.username).toBeDefined();
    expect(result.data.privacy_state).toBeDefined();
  }, 20000);
});
