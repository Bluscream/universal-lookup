import axios from 'axios';
import { config } from '../../config.js';
import type { LookupType, Provider, ProviderResult, TelData } from '../../types/common.js';

const PROVIDER_NAME = 'fritzbox';

/**
 * FritzBox phone book lookup via TR-064/HTTP API.
 * Optional — requires FRITZBOX_HOST, FRITZBOX_USER, FRITZBOX_PASS.
 */

/**
 * A downloaded phonebook, kept with the box's own `<timestamp>` so it can be
 * revalidated instead of re-downloaded, and with a number index so a lookup
 * does not rescan the XML.
 */
interface CachedBook {
  data: string;
  fetchedAt: number;
  /** The `<timestamp>` the box reported for this book — its version marker. */
  bookTs: string;
  index: Map<string, { xml: string; type: string }>;
}
const phonebookCache: Record<number, CachedBook> = {};
/** Which phonebook IDs the box reports, cached on the phonebook TTL. */
let phonebookIdCache: { ids: number[]; timestamp: number } | null = null;
/**
 * Book ID to name, so a skipped book can be skipped without even the SOAP call
 * that would name it. Learned from the GetPhonebook reply, dropped with the ID
 * cache.
 */
const bookNameCache: Record<number, string> = {};

/**
 * How many trailing digits identify a number.
 *
 * Phonebook entries are stored as a human typed them, and on the box this was
 * tested against 40 of 82 external numbers carried dashes or spaces —
 * `030-123-456789`, `01577 1234567` — so comparing the stored text against a
 * normalized query found fewer than half of them. Reducing both sides to their
 * trailing digits makes the comparison independent of punctuation and of
 * whether the entry was written `+49…`, `0049…` or `0…`.
 *
 * Nine digits is long enough that two different subscribers colliding is not a
 * practical concern, while still matching a national number against the same
 * number written in international form.
 */
const SIGNIFICANT_DIGITS = 9;

/** The comparison key for a phone number, in any notation. */
function numberKey(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  return digits.length > SIGNIFICANT_DIGITS ? digits.slice(-SIGNIFICANT_DIGITS) : digits;
}

/**
 * Index every number in a phonebook by its comparison key.
 *
 * Built once per download rather than per lookup: the previous scan compiled a
 * fresh RegExp for every contact times every query spelling, on data that was
 * already cached.
 */
function buildIndex(xml: string): Map<string, { xml: string; type: string }> {
  const index = new Map<string, { xml: string; type: string }>();
  for (const chunk of xml.split('</contact>')) {
    const startIdx = chunk.indexOf('<contact>');
    if (startIdx === -1) continue;
    const contactXml = `${chunk.substring(startIdx)}</contact>`;
    for (const m of contactXml.matchAll(/<number([^>]*)>([^<]*)<\/number>/g)) {
      const key = numberKey(m[2]);
      // First contact wins, matching the order the old sequential scan used.
      if (!key || index.has(key)) continue;
      index.set(key, { xml: contactXml, type: m[1].match(/type="([^"]*)"/)?.[1] || 'unknown' });
    }
  }
  return index;
}

/**
 * Should this phonebook be left undownloaded?
 *
 * Matched on the book's name rather than its ID, because the IDs differ per box
 * while AVM's names for these are stable. Comma-separated, case-insensitive
 * substring match, so "blocklist" catches "Blocklist" and "SPAM Blocklist".
 */
function isSkippedPhonebook(name: string): boolean {
  const needle = name.toLowerCase();
  return config.fritzboxSkipPhonebooks
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .some((skip) => needle.includes(skip));
}

/** Reset the module caches. Tests, and anything that reconfigures the box. */
export function clearFritzboxPhonebookCache(): void {
  for (const key of Object.keys(phonebookCache)) delete phonebookCache[Number(key)];
  for (const key of Object.keys(bookNameCache)) delete bookNameCache[Number(key)];
  phonebookIdCache = null;
}

export const fritzbox: Provider = {
  name: PROVIDER_NAME,
  isAvailable() {
    return !!(config.fritzboxHost && config.fritzboxUser && config.fritzboxPass);
  },

  async lookup(query: string, _type?: LookupType): Promise<ProviderResult<TelData>> {
    const { normalizeTel } = await import('../../lib/normalizer.js');
    const start = Date.now();
    const numClean = normalizeTel(query);
    if (!numClean) {
      return {
        provider: PROVIDER_NAME,
        success: false,
        data: {},
        error: 'Invalid phone number',
        duration: Date.now() - start,
      };
    }

    try {
      let baseUrl = config.fritzboxHost;
      if (!baseUrl.startsWith('http')) {
        const host = baseUrl.includes(':') ? baseUrl : `${baseUrl}:49443`;
        const protocol = host.includes('49443') ? 'https' : 'http';
        baseUrl = `${protocol}://${host}`;
      }

      const soapUrl = `${baseUrl}/upnp/control/x_contact`;

      // Helper for Digest Auth
      const md5 = (str: string) =>
        import('node:crypto').then((c) => c.createHash('md5').update(str).digest('hex'));

      const httpsAgent = new (await import('node:https')).Agent({
        rejectUnauthorized: false,
      });

      const performSoapRequest = async (
        body: string,
        authHeader?: string,
        action = 'GetPhonebook',
      ) => {
        return axios.post(soapUrl, body, {
          timeout: config.serverTimeout,
          httpsAgent,
          headers: {
            'Content-Type': 'text/xml; charset="utf-8"',
            SoapAction: `urn:dslforum-org:service:X_AVM-DE_OnTel:1#${action}`,
            ...(authHeader ? { Authorization: authHeader } : {}),
          },
          validateStatus: (status) => status === 200 || status === 401,
        });
      };

      const getListSoapBody = () => `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/envelope/">
  <s:Body>
    <u:GetPhonebookList xmlns:u="urn:dslforum-org:service:X_AVM-DE_OnTel:1" />
  </s:Body>
</s:Envelope>`;

      const getSoapBody = (id: number) => `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/envelope/">
  <s:Body>
    <u:GetPhonebook xmlns:u="urn:dslforum-org:service:X_AVM-DE_OnTel:1">
      <NewPhonebookID>${id}</NewPhonebookID>
    </u:GetPhonebook>
  </s:Body>
</s:Envelope>`;

      // Helper for fresh Digest Auth challenge
      const getAuth = async () => {
        const resp = await performSoapRequest(getSoapBody(0));
        if (resp.status === 401) {
          const wwwAuth = resp.headers['www-authenticate'];
          if (!wwwAuth) throw new Error('401 Unauthorized but no WWW-Authenticate header');

          // More robust parsing for WWW-Authenticate
          const authParams: Record<string, string> = {};
          const matches = wwwAuth.matchAll(/(\w+)=["']?([^"',]+)["']?/g);
          for (const match of matches) {
            authParams[match[1]] = match[2];
          }

          const { realm, nonce, qop } = authParams;
          const uri = '/upnp/control/x_contact';
          const ha1 = await md5(`${config.fritzboxUser}:${realm}:${config.fritzboxPass}`);
          const ha2 = await md5(`POST:${uri}`);

          if (qop === 'auth') {
            const cnonce = Math.random().toString(36).substring(2, 10);
            const nc = '00000001';
            const response = await md5(`${ha1}:${nonce}:${nc}:${cnonce}:auth:${ha2}`);
            return `Digest username="${config.fritzboxUser}", realm="${realm}", nonce="${nonce}", uri="${uri}", qop=auth, nc=${nc}, cnonce="${cnonce}", response="${response}"`;
          } else {
            const response = await md5(`${ha1}:${nonce}:${ha2}`);
            return `Digest username="${config.fritzboxUser}", realm="${realm}", nonce="${nonce}", uri="${uri}", response="${response}"`;
          }
        }
        return undefined;
      };

      const data: TelData = {};
      let rawMatch: string | undefined;
      let authHeader: string | undefined;

      // 2. Ask the box which phonebooks exist, rather than assuming 0, 1, 2.
      //
      // The IDs are not a contiguous 0..2 range: a box syncing an online
      // address book or holding a call-barring list gets extra books, and the
      // hardcoded [0, 1, 2] silently missed everything above index 2. On the
      // box this was tested against that meant skipping a Google-synced book of
      // 43 contacts — about half the real contacts — while still paying for two
      // books that hold almost none.
      if (!authHeader) authHeader = await getAuth();
      let phonebookIds: number[];
      const cachedIds = phonebookIdCache;
      if (cachedIds && Date.now() - cachedIds.timestamp < config.fritzboxPhonebookTtl * 1000) {
        phonebookIds = cachedIds.ids;
      } else {
        const listResp = await performSoapRequest(
          getListSoapBody(),
          authHeader,
          'GetPhonebookList',
        );
        const listMatch =
          listResp.status === 200
            ? listResp.data.match(/<NewPhonebookList>([^<]*)<\/NewPhonebookList>/)
            : null;
        phonebookIds = listMatch
          ? listMatch[1]
              .split(',')
              .map((s: string) => Number.parseInt(s.trim(), 10))
              .filter((n: number) => Number.isInteger(n))
          : [0];
        phonebookIdCache = { ids: phonebookIds, timestamp: Date.now() };
      }

      // The keys this query can match under, computed the same way the index
      // was built so notation on either side is irrelevant.
      const searchKeys = [numberKey(numClean)];
      if (config.phoneLocalPrefix && numClean.startsWith(config.phoneLocalPrefix)) {
        // A contact stored without the area code still has to be found.
        const localKey = numberKey(numClean.substring(config.phoneLocalPrefix.length));
        if (localKey) searchKeys.push(localKey);
      }

      for (const id of phonebookIds) {
        const now = Date.now();
        const cached = phonebookCache[id];
        const age = cached ? now - cached.fetchedAt : Number.POSITIVE_INFINITY;
        let book: CachedBook | undefined;

        if (cached && age < config.fritzboxPhonebookRevalidate * 1000) {
          book = cached;
        } else if (bookNameCache[id] !== undefined && isSkippedPhonebook(bookNameCache[id])) {
          // Already known to be a skipped book — no need to ask the box again.
          continue;
        } else {
          // A fresh GetPhonebook is needed regardless: the download URL carries
          // a session id that expires. It also names the book.
          if (!authHeader) authHeader = await getAuth();
          const resp = await performSoapRequest(getSoapBody(id), authHeader);
          if (resp.status !== 200) {
            // Serving a stale copy beats losing the book over one failed call.
            if (!cached) continue;
            book = cached;
          } else {
            // Skip a book by name *before* downloading it — the SOAP reply is a
            // few hundred bytes while the book itself can be hundreds of KB. On
            // the box this was tested against the call-barring list alone was
            // 315 KB of a 360 KB total (~87%), and holds no contacts worth
            // resolving a caller against.
            const nameMatch = resp.data.match(/<NewPhonebookName>([^<]*)<\/NewPhonebookName>/);
            const pbName = nameMatch ? nameMatch[1] : '';
            if (pbName) bookNameCache[id] = pbName;
            if (pbName && isSkippedPhonebook(pbName)) continue;

            const urlMatch = resp.data.match(/<NewPhonebookURL>([^<]+)<\/NewPhonebookURL>/);
            if (!urlMatch) {
              if (!cached) continue;
              book = cached;
            } else {
              // Always the URL the box gave us: the TR-064 index is not the
              // internal pbid, so a hand-built phonebook.lua?pbid=<index> can
              // return an empty book with HTTP 200 and no error at all.
              const phonebookUrl = urlMatch[1].replace(/&amp;/g, '&');

              // Revalidate rather than re-download. phonebook.lua takes a
              // `timestamp` parameter and answers an unchanged book with just
              // its header — measured at ~220 bytes against 16–315 KB for the
              // book itself, 1,076 bytes to prove all five are current. Past
              // the TTL, download unconditionally as a safety net.
              const conditional = !!cached?.bookTs && age < config.fritzboxPhonebookTtl * 1000;
              const sep = phonebookUrl.includes('?') ? '&' : '?';
              const fetchUrl = conditional
                ? `${phonebookUrl}${sep}timestamp=${cached?.bookTs}`
                : phonebookUrl;

              const pbResp = await axios.get(fetchUrl, {
                timeout: config.serverTimeout,
                httpsAgent,
                // The book is XML to be matched as text, so keep it as sent
                // rather than letting axios guess at a parse.
                responseType: 'text',
                transformResponse: [(d) => d],
              });
              const pbData = pbResp.data as string;
              const bookTs = pbData.match(/<timestamp>(\d+)<\/timestamp>/)?.[1] ?? '';

              // "Unchanged" is the box echoing our timestamp back with no
              // contacts. Requiring both means a book that was genuinely
              // emptied still refreshes, since emptying it moves the timestamp.
              if (conditional && bookTs === cached?.bookTs && !pbData.includes('<contact>')) {
                cached.fetchedAt = now;
                book = cached;
              } else {
                book = { data: pbData, fetchedAt: now, bookTs, index: buildIndex(pbData) };
                phonebookCache[id] = book;
              }
            }
          }
        }

        for (const key of searchKeys) {
          const hit = book.index.get(key);
          if (!hit) continue;

          const nameMatch = hit.xml.match(/<realName>([^<]+)<\/realName>/);
          if (nameMatch) data.name = nameMatch[1];

          data.number_type = hit.type;

          const emailMatches = [...hit.xml.matchAll(/<email[^>]*>([^<]+)<\/email>/g)];
          if (emailMatches.length > 0) {
            data.emails = emailMatches.map((m) => m[1]);
          }

          const photoMatch = hit.xml.match(/<imageURL>([^<]+)<\/imageURL>/);
          if (photoMatch) {
            const url = photoMatch[1];
            data.photo_url = url.startsWith('/') ? `${baseUrl}${url}` : url;
          }

          rawMatch = hit.xml;
          break;
        }
        if (data.name) break;
      }

      return {
        provider: PROVIDER_NAME,
        success: !!data.name,
        data,
        raw: rawMatch,
        error: !data.name ? 'Number not found in any FritzBox phonebook' : undefined,
        duration: Date.now() - start,
      };
    } catch (error) {
      let errorMessage = 'Unknown error';
      if (axios.isAxiosError(error)) {
        if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
          errorMessage = `Timeout after ${Date.now() - start}ms`;
        } else if (error.code === 'ECONNREFUSED') {
          errorMessage = 'Connection refused (check FRITZBOX_HOST and port)';
        } else if (error.response?.status === 401) {
          errorMessage = 'Authentication failed (check FRITZBOX_USER/PASS)';
        } else {
          errorMessage = error.message;
        }
      } else if (error instanceof Error) {
        errorMessage = error.message;
      }

      return {
        provider: PROVIDER_NAME,
        success: false,
        data: {},
        error: errorMessage,
        duration: Date.now() - start,
      };
    }
  },
};
