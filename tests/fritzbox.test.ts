import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('axios', () => ({
  default: { post: vi.fn(), get: vi.fn(), isAxiosError: () => false },
}));

const axios = (await import('axios')).default;
const { config } = await import('../backend/src/config.js');
const { fritzbox, clearFritzboxPhonebookCache } = await import(
  '../backend/src/providers/tel/fritzbox.js'
);

/** The five phonebooks a box with an online address book and a barring list reports. */
const BOOKS: Record<number, string> = {
  0: 'Telefonbuch',
  1: 'Call locks',
  2: 'Tellows Score 9',
  3: 'contacts@example.com',
  4: 'Blocklist',
};

/** Which phonebook URLs were actually downloaded — the bytes that matter. */
let fetched: string[] = [];

function mockBox(ids = '0,1,2,3,4'): void {
  vi.mocked(axios.post).mockImplementation((async (_url: unknown, body: unknown) => {
    const b = String(body);
    if (b.includes('GetPhonebookList')) {
      return { status: 200, data: `<r><NewPhonebookList>${ids}</NewPhonebookList></r>` };
    }
    const id = Number(b.match(/<NewPhonebookID>(\d+)<\/NewPhonebookID>/)?.[1] ?? -1);
    return {
      status: 200,
      data:
        `<r><NewPhonebookName>${BOOKS[id] ?? 'Unknown'}</NewPhonebookName>` +
        `<NewPhonebookURL>http://box/phonebook.lua?pbid=${id}</NewPhonebookURL></r>`,
    };
  }) as never);

  vi.mocked(axios.get).mockImplementation((async (url: unknown) => {
    fetched.push(String(url));
    return { status: 200, data: '<phonebooks><phonebook></phonebook></phonebooks>' };
  }) as never);
}

const pbids = () => fetched.map((u) => Number(u.match(/pbid=(-?\d+)/)?.[1])).sort((a, b) => a - b);

describe('fritzbox phonebook selection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearFritzboxPhonebookCache();
    fetched = [];
    config.fritzboxHost = '192.168.178.1:49000';
    config.fritzboxUser = 'tester';
    config.fritzboxPass = 'secret';
    config.fritzboxSkipPhonebooks = 'Blocklist,Call locks,Sperrliste,Tellows';
  });

  it('asks the box which phonebooks exist instead of assuming 0..2', async () => {
    mockBox();
    await fritzbox.lookup('06131177949');

    const listCalls = vi
      .mocked(axios.post)
      .mock.calls.filter(([, b]) => String(b).includes('GetPhonebookList'));
    expect(listCalls.length).toBeGreaterThanOrEqual(1);
  });

  it('downloads only the real contact books, skipping barring and spam lists', async () => {
    mockBox();
    await fritzbox.lookup('06131177949');

    // Book 3 is the online address book that the old hardcoded [0,1,2] missed
    // entirely; books 1, 2 and 4 hold no contacts worth resolving against and
    // book 4 alone dominated the download.
    expect(pbids()).toEqual([0, 3]);
  });

  it('never downloads a skipped book at all', async () => {
    mockBox();
    await fritzbox.lookup('06131177949');

    expect(fetched.some((u) => u.includes('pbid=4'))).toBe(false);
  });

  it('fetches every book when the skip list is empty', async () => {
    config.fritzboxSkipPhonebooks = '';
    mockBox();
    await fritzbox.lookup('06131177949');

    expect(pbids()).toEqual([0, 1, 2, 3, 4]);
  });

  it('matches names case-insensitively, as substrings', async () => {
    config.fritzboxSkipPhonebooks = 'blocklist';
    mockBox();
    await fritzbox.lookup('06131177949');

    expect(fetched.some((u) => u.includes('pbid=4'))).toBe(false); // "Blocklist"
    expect(fetched.some((u) => u.includes('pbid=1'))).toBe(true); // "Call locks" kept now
  });

  it('handles non-contiguous IDs, which a hardcoded range cannot', async () => {
    config.fritzboxSkipPhonebooks = '';
    mockBox('0,3,240');
    await fritzbox.lookup('06131177949');

    expect(pbids()).toEqual([0, 3, 240]);
  });

  it('falls back to book 0 when the list call fails rather than giving up', async () => {
    vi.mocked(axios.post).mockImplementation((async (_url: unknown, body: unknown) => {
      const b = String(body);
      if (b.includes('GetPhonebookList')) return { status: 500, data: '' };
      return {
        status: 200,
        data:
          '<r><NewPhonebookName>Telefonbuch</NewPhonebookName>' +
          '<NewPhonebookURL>http://box/phonebook.lua?pbid=0</NewPhonebookURL></r>',
      };
    }) as never);
    vi.mocked(axios.get).mockImplementation((async (url: unknown) => {
      fetched.push(String(url));
      return { status: 200, data: '<phonebooks></phonebooks>' };
    }) as never);

    await fritzbox.lookup('06131177949');

    expect(pbids()).toEqual([0]);
  });

  it('caches the phonebook list rather than asking on every lookup', async () => {
    mockBox();
    await fritzbox.lookup('06131177949');
    const afterFirst = vi
      .mocked(axios.post)
      .mock.calls.filter(([, b]) => String(b).includes('GetPhonebookList')).length;

    await fritzbox.lookup('06131177949');
    const afterSecond = vi
      .mocked(axios.post)
      .mock.calls.filter(([, b]) => String(b).includes('GetPhonebookList')).length;

    expect(afterSecond).toBe(afterFirst);
  });
});
