import dns from 'node:dns/promises';
import type { Provider, ProviderResult } from '../../types/common.js';

const PROVIDER_NAME = 'dns-email';

/**
 * DNS-based email validation — checks MX records, domain existence, and basic syntax.
 * No API key required, uses DNS resolution.
 */
export const dnsEmail: Provider = {
  name: PROVIDER_NAME,
  isAvailable() { return true; },

  async lookup(query: string): Promise<ProviderResult> {
    const start = Date.now();
    try {
      // Validate syntax
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(query)) {
        return {
          provider: PROVIDER_NAME, success: true,
          data: { valid_syntax: false, email: query },
          duration: Date.now() - start,
        };
      }

      const [username, domain] = query.split('@');
      const data: Record<string, unknown> = {
        email: query,
        email_username: username,
        email_domain: domain,
        valid_syntax: true,
      };

      // Check for disposable email domains
      const disposableDomains = [
        'guerrillamail.com', 'guerrillamailblock.com', 'grr.la', 'guerrillamail.info',
        'tempmail.com', 'temp-mail.org', 'throwaway.email', 'temp-mail.io',
        'mailinator.com', 'maildrop.cc', 'yopmail.com', 'dispostable.com',
        'sharklasers.com', 'guerrillamail.net', 'guerrillamail.org',
        'trashmail.com', 'trashmail.me', 'trashmail.net', 'trashmail.org',
        'fakeinbox.com', 'mailnesia.com', 'mailcatch.com', 'binkmail.com',
        'tempr.email', 'tempail.com', 'mohmal.com', 'burnermail.io',
        '10minutemail.com', 'minutemail.com', 'tempmailaddress.com',
      ];
      data.disposable = disposableDomains.includes(domain.toLowerCase());

      // Check for common free providers
      const freeProviders = [
        'gmail.com', 'yahoo.com', 'yahoo.de', 'hotmail.com', 'outlook.com',
        'live.com', 'aol.com', 'icloud.com', 'mail.com', 'protonmail.com',
        'proton.me', 'gmx.de', 'gmx.net', 'gmx.at', 'web.de', 't-online.de',
        'freenet.de', 'arcor.de', 'zoho.com', 'yandex.com', 'yandex.ru',
        'fastmail.com', 'tutanota.com', 'tuta.io', 'me.com', 'msn.com',
      ];
      data.free_provider = freeProviders.includes(domain.toLowerCase());

      // Check for role accounts
      const roleAccounts = [
        'admin', 'administrator', 'postmaster', 'webmaster', 'hostmaster',
        'info', 'support', 'contact', 'noreply', 'no-reply', 'mailer-daemon',
        'abuse', 'sales', 'billing', 'help', 'service', 'security',
      ];
      data.role_account = roleAccounts.includes(username.toLowerCase());

      // Run all DNS queries in parallel for speed
      const resolver = new dns.Resolver();
      resolver.setServers(['1.1.1.1', '8.8.8.8']);

      const [mxResult, aResult, txtResult, dmarcResult] = await Promise.allSettled([
        resolver.resolveMx(domain),
        resolver.resolve4(domain),
        resolver.resolveTxt(domain),
        resolver.resolveTxt(`_dmarc.${domain}`),
      ]);

      // MX records
      if (mxResult.status === 'fulfilled') {
        data.mx_records = true;
        data.mx_hosts = mxResult.value
          .sort((a, b) => a.priority - b.priority)
          .map(mx => ({ priority: mx.priority, host: mx.exchange }));
      } else {
        data.mx_records = false;
      }

      // A records
      if (aResult.status === 'fulfilled') {
        data.domain_exists = true;
        data.domain_ips = aResult.value;
      } else {
        data.domain_exists = data.mx_records === true;
      }

      // SPF
      if (txtResult.status === 'fulfilled') {
        const spfRecord = txtResult.value.flat().find(r => r.startsWith('v=spf1'));
        data.spf = !!spfRecord;
        if (spfRecord) data.spf_record = spfRecord;
      } else {
        data.spf = false;
      }

      // DMARC
      if (dmarcResult.status === 'fulfilled') {
        const dmarcRecord = dmarcResult.value.flat().find(r => r.startsWith('v=DMARC1'));
        data.dmarc = !!dmarcRecord;
        if (dmarcRecord) data.dmarc_record = dmarcRecord;
      } else {
        data.dmarc = false;
      }

      return {
        provider: PROVIDER_NAME, success: true,
        data, duration: Date.now() - start,
      };
    } catch (error) {
      return { provider: PROVIDER_NAME, success: false, data: {}, error: error instanceof Error ? error.message : String(error), duration: Date.now() - start };
    }
  },
};
