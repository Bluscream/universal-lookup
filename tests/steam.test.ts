import { describe, expect, it } from 'vitest';
import { playerDbProvider } from '../src/providers/steam/playerdb.js';
import { steamXmlProvider } from '../src/providers/steam/steam-xml.js';

describe('PlayerDB Steam Provider', () => {
  it('fetches profile details for gabelogannewell', async () => {
    // Gaben's SteamID64 is 76561197960287930
    const result = await playerDbProvider.lookup('76561197960287930');
    expect(result.success).toBe(true);
    expect(result.data.steam_id_64).toBe('76561197960287930');
    expect(result.data.username).toBeDefined();
  });
});

describe('Steam XML Provider', () => {
  it('scrapes public XML profile details', async () => {
    const result = await steamXmlProvider.lookup('76561197960287930');
    expect(result.success).toBe(true);
    expect(result.data.steam_id_64).toBe('76561197960287930');
    expect(result.data.username).toBeDefined();
    expect(result.data.privacy_state).toBeDefined();
  });
});
