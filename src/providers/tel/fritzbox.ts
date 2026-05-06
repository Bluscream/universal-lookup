import axios from 'axios';
import { config } from '../../config.js';
import type { Provider, ProviderResult } from '../../types/common.js';

const PROVIDER_NAME = 'fritzbox';

/**
 * FritzBox phone book lookup via TR-064/HTTP API.
 * Optional — requires FRITZBOX_HOST, FRITZBOX_USER, FRITZBOX_PASS.
 */
export const fritzbox: Provider = {
  name: PROVIDER_NAME,
  isAvailable() {
    return !!(config.fritzboxHost && config.fritzboxUser && config.fritzboxPass);
  },

  async lookup(query: string): Promise<ProviderResult> {
    const start = Date.now();
    try {
      // FritzBox SOAP request to get phone book
      const soapBody = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:GetPhonebook xmlns:u="urn:dslforum-org:service:X_AVM-DE_OnTel:1">
      <NewPhonebookID>0</NewPhonebookID>
    </u:GetPhonebook>
  </s:Body>
</s:Envelope>`;

      const resp = await axios.post(
        `http://${config.fritzboxHost}:49000/upnp/control/x_contact`,
        soapBody,
        {
          timeout: config.providerTimeout,
          headers: {
            'Content-Type': 'text/xml; charset="utf-8"',
            SoapAction: 'urn:dslforum-org:service:X_AVM-DE_OnTel:1#GetPhonebook',
          },
          auth: { username: config.fritzboxUser, password: config.fritzboxPass },
        },
      );

      // Parse the phonebook URL from SOAP response and search for the number
      const urlMatch = resp.data.match(/<NewPhonebookURL>([^<]+)<\/NewPhonebookURL>/);
      if (!urlMatch) {
        return {
          provider: PROVIDER_NAME,
          success: false,
          data: {},
          error: 'Could not get phonebook URL',
          duration: Date.now() - start,
        };
      }

      const pbResp = await axios.get(urlMatch[1], { timeout: config.providerTimeout });
      const data: Record<string, unknown> = {};

      // Search for the number in the phonebook XML
      const numClean = query.replace(/[^0-9]/g, '');
      const contactMatch = pbResp.data.match(
        new RegExp(`<contact>[\\s\\S]*?${numClean}[\\s\\S]*?<\\/contact>`, 'i'),
      );
      if (contactMatch) {
        const nameMatch = contactMatch[0].match(/<realName>([^<]+)<\/realName>/);
        if (nameMatch) data.name = nameMatch[1];
        data.fritzbox_match = true;
      }

      return {
        provider: PROVIDER_NAME,
        success: Object.keys(data).length > 0,
        data,
        raw: contactMatch?.[0],
        error: Object.keys(data).length === 0 ? 'Number not in FritzBox phonebook' : undefined,
        duration: Date.now() - start,
      };
    } catch (error) {
      return {
        provider: PROVIDER_NAME,
        success: false,
        data: {},
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - start,
      };
    }
  },
};
