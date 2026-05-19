import https from 'node:https';
import type tls from 'node:tls';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { config } from '../../config.js';
import type { LookupType, Provider, ProviderResult } from '../../types/common.js';

const PROVIDER_NAME = 'metadata';

/**
 * Fetch SSL certificate details for a hostname on port 443.
 */
function getSslCertificate(hostname: string): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    let resolved = false;

    const options = {
      host: hostname,
      port: 443,
      method: 'GET',
      rejectUnauthorized: false, // Retrieve certificate even if self-signed or invalid
      agent: false,
    };

    const req = https.request(options, (res) => {
      if (resolved) return;
      resolved = true;

      const socket = res.socket as tls.TLSSocket;
      const cert = socket.getPeerCertificate();

      if (cert && Object.keys(cert).length > 0) {
        const validToTime = new Date(cert.valid_to).getTime();
        const daysRemaining = Math.round((validToTime - Date.now()) / (1000 * 60 * 60 * 24));

        resolve({
          subject: cert.subject?.CN || cert.subject,
          subject_org: cert.subject?.O || null,
          issuer: cert.issuer?.CN || cert.issuer,
          issuer_org: cert.issuer?.O || null,
          valid_from: cert.valid_from,
          valid_to: cert.valid_to,
          days_remaining: daysRemaining,
          is_expired: Date.now() > validToTime,
          serial_number: cert.serialNumber,
          fingerprint: cert.fingerprint,
        });
      } else {
        resolve(null);
      }
      req.destroy();
    });

    req.on('error', () => {
      if (!resolved) {
        resolved = true;
        resolve(null);
      }
    });

    req.setTimeout(5000, () => {
      if (!resolved) {
        resolved = true;
        resolve(null);
      }
      req.destroy();
    });

    req.end();
  });
}

/**
 * metadata — Standard URL web scraper, redirect tracker, and SSL cert checker.
 */
export const metadataProvider: Provider = {
  name: PROVIDER_NAME,

  isAvailable() {
    return true; // Built-in scraper, always available
  },

  async lookup(query: string, _type?: LookupType): Promise<ProviderResult> {
    const start = Date.now();

    try {
      let currentUrl = query;
      const redirectChain: { url: string; status: number }[] = [];
      let depth = 0;
      const maxDepth = 6;
      let finalResponse = null;

      // 1. Follow redirect chain manually to document redirects
      while (depth < maxDepth) {
        try {
          const resp = await axios.get(currentUrl, {
            maxRedirects: 0,
            validateStatus: (status) => status >= 200 && status < 400,
            timeout: Math.min(5000, config.providerTimeout),
            headers: {
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            },
          });

          if (resp.status >= 300 && resp.status < 400 && resp.headers.location) {
            const nextUrl = new URL(resp.headers.location, currentUrl).toString();
            redirectChain.push({ url: currentUrl, status: resp.status });
            currentUrl = nextUrl;
            depth++;
          } else {
            finalResponse = resp;
            break;
          }
        } catch (err) {
          // If we encounter an error but have completed redirects, fallback to final URL
          if (axios.isAxiosError(err) && err.response) {
            finalResponse = err.response;
          } else {
            throw err;
          }
          break;
        }
      }

      if (!finalResponse) {
        throw new Error('Failed to reach landing page');
      }

      const landingUrl = currentUrl;
      const urlObj = new URL(landingUrl);
      const isHttps = urlObj.protocol === 'https:';

      // 2. SSL certificate check
      let ssl: Record<string, unknown> | null = null;
      if (isHttps) {
        ssl = await getSslCertificate(urlObj.hostname);
      }

      // 3. Extract headers
      const headers = finalResponse.headers || {};
      const securityHeaders = {
        content_security_policy:
          typeof headers['content-security-policy'] === 'string'
            ? headers['content-security-policy']
            : null,
        strict_transport_security:
          typeof headers['strict-transport-security'] === 'string'
            ? headers['strict-transport-security']
            : null,
        x_frame_options:
          typeof headers['x-frame-options'] === 'string' ? headers['x-frame-options'] : null,
        x_content_type_options:
          typeof headers['x-content-type-options'] === 'string'
            ? headers['x-content-type-options']
            : null,
        x_xss_protection:
          typeof headers['x-xss-protection'] === 'string' ? headers['x-xss-protection'] : null,
        referrer_policy:
          typeof headers['referrer-policy'] === 'string' ? headers['referrer-policy'] : null,
      };

      // 4. Scrape HTML metadata
      const contentType =
        typeof headers['content-type'] === 'string' ? headers['content-type'] : '';
      let meta: Record<string, unknown> = {};

      if (contentType.includes('text/html') && typeof finalResponse.data === 'string') {
        const $ = cheerio.load(finalResponse.data);

        // Resolve relative favicon URL
        let favicon = $('link[rel*="icon"]').attr('href') || '/favicon.ico';
        try {
          favicon = new URL(favicon, landingUrl).toString();
        } catch {
          // Keep relative if parsing fails
        }

        meta = {
          title: $('title').text().trim() || null,
          description: $('meta[name="description"]').attr('content') || null,
          keywords: $('meta[name="keywords"]').attr('content') || null,
          generator: $('meta[name="generator"]').attr('content') || null,
          favicon,
          open_graph: {
            title: $('meta[property="og:title"]').attr('content') || null,
            description: $('meta[property="og:description"]').attr('content') || null,
            image: $('meta[property="og:image"]').attr('content') || null,
            site_name: $('meta[property="og:site_name"]').attr('content') || null,
            url: $('meta[property="og:url"]').attr('content') || null,
          },
          twitter: {
            card: $('meta[name="twitter:card"]').attr('content') || null,
            title: $('meta[name="twitter:title"]').attr('content') || null,
            description: $('meta[name="twitter:description"]').attr('content') || null,
            image: $('meta[name="twitter:image"]').attr('content') || null,
          },
        };
      }

      const data: Record<string, unknown> = {
        query,
        landing_url: landingUrl,
        http_status: finalResponse.status,
        content_type: contentType,
        content_length:
          typeof headers['content-length'] === 'string' ||
          typeof headers['content-length'] === 'number'
            ? parseInt(String(headers['content-length']), 10)
            : null,
        server: typeof headers.server === 'string' ? headers.server : null,
        powered_by: typeof headers['x-powered-by'] === 'string' ? headers['x-powered-by'] : null,
        redirect_chain: redirectChain,
        is_redirected: redirectChain.length > 0,
        security_headers: securityHeaders,
        ssl,
        meta: Object.keys(meta).length > 0 ? meta : null,
      };

      return {
        provider: PROVIDER_NAME,
        success: true,
        data,
        raw: {
          headers: finalResponse.headers,
          status: finalResponse.status,
        },
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
