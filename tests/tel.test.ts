import { beforeEach, describe, expect, it, vi } from 'vitest';

// Unlike the other suites here, these do not hit the live API: PhoneBlock's own docs ask
// that testing go to their test installation rather than production, so the response is
// stubbed and only our mapping is under test.
vi.mock('axios', () => {
  const get = vi.fn();
  return {
    default: {
      get,
      isAxiosError: (e: unknown) => !!(e as { isAxiosError?: boolean })?.isAxiosError,
    },
  };
});

// Credentials are read off config at call time, so the real .env must not decide
// which auth scheme these assertions see.
vi.mock('../backend/src/config.js', () => ({
  config: {
    serverTimeout: 30000,
    phoneblockApiKey: '',
    phoneblockUser: '',
    phoneblockPassword: '',
  },
}));

const axios = (await import('axios')).default;
const { config } = await import('../backend/src/config.js');
const { phoneblock } = await import('../backend/src/providers/tel/phoneblock.js');

function setCredentials(creds: { apiKey?: string; user?: string; password?: string }) {
  config.phoneblockApiKey = creds.apiKey ?? '';
  config.phoneblockUser = creds.user ?? '';
  config.phoneblockPassword = creds.password ?? '';
}

const SPAM_RESPONSE = {
  phone: '+4917650642602',
  votes: 1010,
  rating: 'C_PING',
  votesWildcard: 0,
  whiteListed: false,
  blackListed: false,
  archived: false,
  dateAdded: 0,
  lastUpdate: 1790690162744,
  label: '(DE) 017650642602',
  location: 'Telefónica Germany GmbH & Co. OHG',
  heat: 0.74,
  spamConfidence: 99,
  calls: 4,
};

describe('PhoneBlock Provider', () => {
  beforeEach(() => {
    vi.mocked(axios.get).mockReset();
    setCredentials({});
  });

  it('is always available, since the number endpoint needs no credentials', () => {
    expect(phoneblock.isAvailable()).toBe(true);
  });

  it('maps a flagged number onto the namespaced tel fields', async () => {
    vi.mocked(axios.get).mockResolvedValue({ data: SPAM_RESPONSE });

    const result = await phoneblock.lookup('004917650642602');

    expect(result.success).toBe(true);
    expect(result.data.phoneblock_rating).toBe('C_PING');
    expect(result.data.phoneblock_rating_label).toBe('Ping call');
    expect(result.data.phoneblock_spam_confidence).toBe(99);
    expect(result.data.phoneblock_votes).toBe(1010);
    expect(result.data.phone_formatted).toBe('(DE) 017650642602');
    expect(result.data.phoneblock_calls).toBe(4);
  });

  it('queries the number endpoint with the normalized 00-prefixed number', async () => {
    vi.mocked(axios.get).mockResolvedValue({ data: SPAM_RESPONSE });

    await phoneblock.lookup('004917650642602');

    const [url] = vi.mocked(axios.get).mock.calls[0];
    expect(url).toBe('https://phoneblock.net/phoneblock/api/num/004917650642602');
  });

  it('converts epoch-millisecond dates and treats 0 as unset', async () => {
    vi.mocked(axios.get).mockResolvedValue({ data: SPAM_RESPONSE });

    const result = await phoneblock.lookup('004917650642602');

    expect(result.data.phoneblock_date_added).toBeUndefined();
    expect(result.data.phoneblock_last_update).toBe(new Date(1790690162744).toISOString());
  });

  it('passes an unrecognized rating code through without a label', async () => {
    // The published spec's own examples carry "C_POLL", which is not in its enum.
    vi.mocked(axios.get).mockResolvedValue({ data: { ...SPAM_RESPONSE, rating: 'C_POLL' } });

    const result = await phoneblock.lookup('004917650642602');

    expect(result.success).toBe(true);
    expect(result.data.phoneblock_rating).toBe('C_POLL');
    expect(result.data.phoneblock_rating_label).toBeUndefined();
  });

  it('reports a malformed number as a failure rather than throwing', async () => {
    vi.mocked(axios.get).mockRejectedValue({
      isAxiosError: true,
      response: { status: 400, data: 'Invalid phone number.' },
    });

    const result = await phoneblock.lookup('4917650642602');

    expect(result.success).toBe(false);
    expect(result.error).toBe('Invalid phone number');
    expect(result.data).toEqual({});
  });

  it('surfaces a transport failure as a provider error', async () => {
    vi.mocked(axios.get).mockRejectedValue(new Error('socket hang up'));

    const result = await phoneblock.lookup('004917650642602');

    expect(result.success).toBe(false);
    expect(result.error).toBe('socket hang up');
  });

  describe('authentication', () => {
    it('sends no credentials when none are configured', async () => {
      vi.mocked(axios.get).mockResolvedValue({ data: SPAM_RESPONSE });

      await phoneblock.lookup('004917650642602');

      const [, options] = vi.mocked(axios.get).mock.calls[0];
      expect(options?.headers?.Authorization).toBeUndefined();
      expect(options?.auth).toBeUndefined();
    });

    it('sends the API key as a bearer token', async () => {
      setCredentials({ apiKey: 'test-key' });
      vi.mocked(axios.get).mockResolvedValue({ data: SPAM_RESPONSE });

      await phoneblock.lookup('004917650642602');

      const [, options] = vi.mocked(axios.get).mock.calls[0];
      expect(options?.headers?.Authorization).toBe('Bearer test-key');
      expect(options?.auth).toBeUndefined();
    });

    it('falls back to basic auth when only user and password are set', async () => {
      setCredentials({ user: 'u', password: 'p' });
      vi.mocked(axios.get).mockResolvedValue({ data: SPAM_RESPONSE });

      await phoneblock.lookup('004917650642602');

      const [, options] = vi.mocked(axios.get).mock.calls[0];
      expect(options?.auth).toEqual({ username: 'u', password: 'p' });
      expect(options?.headers?.Authorization).toBeUndefined();
    });

    it('prefers the API key over the deprecated username and password', async () => {
      setCredentials({ apiKey: 'test-key', user: 'u', password: 'p' });
      vi.mocked(axios.get).mockResolvedValue({ data: SPAM_RESPONSE });

      await phoneblock.lookup('004917650642602');

      const [, options] = vi.mocked(axios.get).mock.calls[0];
      expect(options?.headers?.Authorization).toBe('Bearer test-key');
      expect(options?.auth).toBeUndefined();
    });

    it('ignores a username with no password', async () => {
      setCredentials({ user: 'u' });
      vi.mocked(axios.get).mockResolvedValue({ data: SPAM_RESPONSE });

      await phoneblock.lookup('004917650642602');

      const [, options] = vi.mocked(axios.get).mock.calls[0];
      expect(options?.auth).toBeUndefined();
    });
  });
});
