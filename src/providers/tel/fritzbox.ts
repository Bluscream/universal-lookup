import axios from 'axios';
import { config } from '../../config.js';
import type { LookupType, Provider, ProviderResult } from '../../types/common.js';

const PROVIDER_NAME = 'fritzbox';

/**
 * FritzBox phone book lookup via TR-064/HTTP API.
 * Optional — requires FRITZBOX_HOST, FRITZBOX_USER, FRITZBOX_PASS.
 */

// In-memory cache for phonebook XML
const phonebookCache: Record<number, { data: string; timestamp: number }> = {};
const PHONEBOOK_CACHE_TTL = 60 * 60 * 1000; // 1 hour

export const fritzbox: Provider = {
  name: PROVIDER_NAME,
  isAvailable() {
    return !!(config.fritzboxHost && config.fritzboxUser && config.fritzboxPass);
  },

  async lookup(query: string, _type?: LookupType): Promise<ProviderResult> {
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

      const performSoapRequest = async (body: string, authHeader?: string) => {
        return axios.post(soapUrl, body, {
          timeout: config.serverTimeout,
          httpsAgent,
          headers: {
            'Content-Type': 'text/xml; charset="utf-8"',
            SoapAction: 'urn:dslforum-org:service:X_AVM-DE_OnTel:1#GetPhonebook',
            ...(authHeader ? { Authorization: authHeader } : {}),
          },
          validateStatus: (status) => status === 200 || status === 401,
        });
      };

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

      // 2. Iterate through phonebooks (ID 0, 1, 2)
      const phonebookIds = [0, 1, 2];
      const data: Record<string, unknown> = {};
      let rawMatch: string | undefined;
      let authHeader: string | undefined;

      for (const id of phonebookIds) {
        let pbData: string;
        const now = Date.now();

        // Check cache
        if (phonebookCache[id] && now - phonebookCache[id].timestamp < PHONEBOOK_CACHE_TTL) {
          pbData = phonebookCache[id].data;
        } else {
          // Fetch URL
          if (!authHeader) authHeader = await getAuth();
          const resp = await performSoapRequest(getSoapBody(id), authHeader);
          if (resp.status !== 200) continue;

          const urlMatch = resp.data.match(/<NewPhonebookURL>([^<]+)<\/NewPhonebookURL>/);
          if (!urlMatch) continue;

          const phonebookUrl = urlMatch[1].replace(/&amp;/g, '&');
          const pbResp = await axios.get(phonebookUrl, {
            timeout: config.serverTimeout,
            httpsAgent,
          });
          pbData = pbResp.data as string;

          // Save to cache
          phonebookCache[id] = { data: pbData, timestamp: now };
        }

        // Precise search
        const contacts = pbData.split('</contact>');
        const searchTerms = [
          numClean,
          numClean.replace(/^00/, '+'),
          numClean.replace(/^0049/, '0'),
          numClean.replace(/^0049/, ''),
        ];

        // Add local version if prefix is configured
        if (config.phoneLocalPrefix && numClean.startsWith(config.phoneLocalPrefix)) {
          const localNum = numClean.substring(config.phoneLocalPrefix.length);
          if (localNum) searchTerms.push(localNum);
        }

        for (let contactXml of contacts) {
          const startIdx = contactXml.indexOf('<contact>');
          if (startIdx === -1) continue;
          contactXml = `${contactXml.substring(startIdx)}</contact>`;

          for (const term of searchTerms) {
            const termEscaped = term.replace('+', '\\+');
            // Regex to match the number and capture its type attribute
            const numberRegex = new RegExp(
              `<number[^>]*type="([^"]*)"[^>]*>${termEscaped}<\\/number>`,
              'i',
            );
            const match = contactXml.match(numberRegex);

            if (match) {
              const type = match[1] || 'unknown';

              // 1. Basic Info
              const nameMatch = contactXml.match(/<realName>([^<]+)<\/realName>/);
              if (nameMatch) data.name = nameMatch[1];

              data.number_type = type;

              // 2. Emails
              const emailMatches = [...contactXml.matchAll(/<email[^>]*>([^<]+)<\/email>/g)];
              if (emailMatches.length > 0) {
                data.emails = emailMatches.map((m) => m[1]);
              }

              // 3. Photo
              const photoMatch = contactXml.match(/<imageURL>([^<]+)<\/imageURL>/);
              if (photoMatch) {
                const url = photoMatch[1];
                data.photo_url = url.startsWith('/') ? `${baseUrl}${url}` : url;
              }

              rawMatch = contactXml;
              break;
            }
          }
          if (data.name) break;
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
