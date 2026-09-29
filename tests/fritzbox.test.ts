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

  it('serves a book from cache without re-asking the box inside the window', async () => {
    mockBox();
    await fritzbox.lookup('06131177949');
    const afterFirst = fetched.length;

    await fritzbox.lookup('06131177949');

    expect(fetched.length).toBe(afterFirst);
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

/**
 * A book written the way people actually type numbers. On the box this was
 * tested against, 40 of 82 external numbers carried dashes or spaces, so
 * comparing the stored text against a normalized query found fewer than half.
 */
const BOOK_TS = '1730308258';
const contact = (id: number, name: string, type: string, number: string) =>
  `<contact><category>0</category><person><realName>${name}</realName></person>` +
  `<telephony nid="1"><number type="${type}" id="0">${number}</number></telephony>` +
  `<uniqueid>${id}</uniqueid></contact>`;

const CONTACT_BOOK =
  `<?xml version="1.0" encoding="UTF-8"?><phonebooks><phonebook owner="0" name="Telefonbuch">` +
  `<timestamp>${BOOK_TS}</timestamp>` +
  contact(1, 'Dashes, Dora', 'home', '030-123-456789') +
  contact(2, 'Spaces, Sam', 'mobile', '01577 1234567') +
  contact(3, 'Intl, Ingo', 'work', '+49 6131 177949') +
  contact(4, 'Local, Lena', 'home', '177949') +
  `</phonebook></phonebooks>`;

/** What the box returns for `&timestamp=<current>`: the header, no contacts. */
const UNCHANGED =
  `<?xml version="1.0" encoding="UTF-8"?><phonebooks><phonebook owner="0" name="Telefonbuch">` +
  `<timestamp>${BOOK_TS}</timestamp><!-- not modified --></phonebook></phonebooks>`;

describe('fritzbox number matching', () => {
  /** Every URL the provider downloaded, so conditional requests are visible. */
  let gets: string[] = [];

  function mockContactBook(body: string = CONTACT_BOOK): void {
    vi.mocked(axios.post).mockImplementation((async (_url: unknown, b: unknown) => {
      if (String(b).includes('GetPhonebookList')) {
        return { status: 200, data: '<r><NewPhonebookList>0</NewPhonebookList></r>' };
      }
      return {
        status: 200,
        data:
          '<r><NewPhonebookName>Telefonbuch</NewPhonebookName>' +
          '<NewPhonebookURL>http://box/phonebook.lua?sid=abc&amp;pbid=0</NewPhonebookURL></r>',
      };
    }) as never);
    vi.mocked(axios.get).mockImplementation((async (url: unknown) => {
      gets.push(String(url));
      // Answer a conditional request the way the box does.
      if (String(url).includes('timestamp=') && !String(url).includes('timestamp=1&')) {
        return { status: 200, data: UNCHANGED };
      }
      return { status: 200, data: body };
    }) as never);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    clearFritzboxPhonebookCache();
    gets = [];
    config.fritzboxHost = '192.168.178.1:49000';
    config.fritzboxUser = 'tester';
    config.fritzboxPass = 'secret';
    config.fritzboxSkipPhonebooks = '';
    config.fritzboxPhonebookRevalidate = 60;
    config.fritzboxPhonebookTtl = 3600;
  });

  it('finds a number stored with dashes', async () => {
    mockContactBook();
    const r = await fritzbox.lookup('030123456789');

    expect(r.success).toBe(true);
    expect(r.data.name).toBe('Dashes, Dora');
    expect(r.data.number_type).toBe('home');
  });

  it('finds a number stored with spaces', async () => {
    mockContactBook();
    const r = await fritzbox.lookup('015771234567');

    expect(r.data.name).toBe('Spaces, Sam');
    expect(r.data.number_type).toBe('mobile');
  });

  it('matches a national query against an entry stored in international form', async () => {
    mockContactBook();
    const r = await fritzbox.lookup('06131177949');

    expect(r.data.name).toBe('Intl, Ingo');
  });

  it('does not invent a match for a number that is not in the book', async () => {
    mockContactBook();
    const r = await fritzbox.lookup('030999888777');

    expect(r.success).toBe(false);
    expect(r.data.name).toBeUndefined();
    expect(r.error).toMatch(/not found/i);
  });

  it('revalidates with the box timestamp instead of downloading again', async () => {
    mockContactBook();
    await fritzbox.lookup('06131177949');
    expect(gets).toHaveLength(1);
    expect(gets[0]).not.toContain('timestamp=');

    // Past the revalidation window the book is checked, not re-fetched.
    config.fritzboxPhonebookRevalidate = 0;
    const r = await fritzbox.lookup('06131177949');

    expect(gets).toHaveLength(2);
    expect(gets[1]).toContain(`timestamp=${BOOK_TS}`);
    // The unchanged reply carries no contacts, so the answer must come from the
    // copy already held — otherwise revalidation would silently lose the book.
    expect(r.data.name).toBe('Intl, Ingo');
  });

  it('replaces the cached book when the box reports a new timestamp', async () => {
    mockContactBook();
    await fritzbox.lookup('06131177949');

    const renamed = CONTACT_BOOK.replace(
      `<timestamp>${BOOK_TS}</timestamp>`,
      '<timestamp>99</timestamp>',
    ).replace('Intl, Ingo', 'Intl, Renamed');
    config.fritzboxPhonebookRevalidate = 0;
    vi.mocked(axios.get).mockImplementation((async (url: unknown) => {
      gets.push(String(url));
      return { status: 200, data: renamed };
    }) as never);

    const r = await fritzbox.lookup('06131177949');

    expect(r.data.name).toBe('Intl, Renamed');
  });

  it('downloads unconditionally once past the TTL', async () => {
    mockContactBook();
    await fritzbox.lookup('06131177949');

    config.fritzboxPhonebookRevalidate = 0;
    config.fritzboxPhonebookTtl = 0;
    await fritzbox.lookup('06131177949');

    expect(gets[1]).not.toContain('timestamp=');
  });

  it('keeps serving a cached book when the box stops answering', async () => {
    mockContactBook();
    await fritzbox.lookup('06131177949');

    config.fritzboxPhonebookRevalidate = 0;
    vi.mocked(axios.post).mockImplementation((async () => ({ status: 500, data: '' })) as never);

    const r = await fritzbox.lookup('06131177949');

    expect(r.data.name).toBe('Intl, Ingo');
  });
});
