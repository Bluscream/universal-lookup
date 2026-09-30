import axios from 'axios';
import { config } from '../../config.js';
import type { Provider, ShortLink } from '../../types/common.js';
import { asProvider, type Shortener } from './shared.js';

/**
 * YOURLS — a self-hosted shortener, and the reason this lookup type exists.
 *
 * It is registered first so that the merged response's flat `short_url` is the
 * one on the operator's own domain; the public services fill in around it.
 *
 * Authentication is either a signature token (`signature=`, the documented
 * passwordless machine credential) or a username/password pair. Both default to
 * empty in the repo and both stay out of it: a token writes to somebody's own
 * server. With neither configured — or with no YOURLS_API_URL — the provider
 * reports itself unavailable, which the probe prints as "unconfigured" rather
 * than as a failure.
 */

const PROVIDER_NAME = 'yourls';

/** The credentials YOURLS accepts, in the order it prefers them. */
export function yourlsAuth(): Record<string, string> | undefined {
  if (config.yourlsSignature) return { signature: config.yourlsSignature };
  if (config.yourlsUsername && config.yourlsPassword) {
    return { username: config.yourlsUsername, password: config.yourlsPassword };
  }
  return undefined;
}

export function yourlsConfigured(): boolean {
  return Boolean(config.yourlsApiUrl) && yourlsAuth() !== undefined;
}

/** YOURLS dates are `YYYY-MM-DD HH:MM:SS` in the instance's own timezone. */
function isoDate(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const parsed = new Date(value.replace(' ', 'T'));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

interface YourlsResponse {
  status?: string;
  code?: string;
  message?: string;
  shorturl?: string;
  title?: string;
  url?: { keyword?: string; url?: string; title?: string; date?: string; clicks?: string | number };
}

function linkFrom(body: YourlsResponse, url: string, existing: boolean): ShortLink {
  const clicks = body.url?.clicks;
  return {
    service: PROVIDER_NAME,
    short_url: body.shorturl as string,
    long_url: body.url?.url ?? url,
    keyword: body.url?.keyword ?? null,
    created: isoDate(body.url?.date),
    clicks: clicks === undefined ? null : Number(clicks),
    existing,
  };
}

const yourlsShortener: Shortener = {
  name: PROVIDER_NAME,
  available: yourlsConfigured,

  async create(url: string) {
    // POST, not GET: the URL being shortened and the credentials both end up in
    // the query string otherwise, where every proxy and access log on the way
    // keeps a copy of the signature.
    const resp = await axios.post(
      config.yourlsApiUrl,
      new URLSearchParams({
        ...yourlsAuth(),
        action: 'shorturl',
        url,
        format: 'json',
      }).toString(),
      {
        timeout: config.serverTimeout,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      },
    );

    const body = (resp.data ?? {}) as YourlsResponse;

    if (body.status === 'success' && body.shorturl) {
      return { link: linkFrom(body, url, false), raw: body };
    }

    // "already exists in database" is a refusal with a usable answer attached:
    // the instance hands back the link it already had. That is not a failure,
    // but it is not a creation either, so the link is flagged `existing`.
    if (body.code === 'error:url' && body.shorturl) {
      return { link: linkFrom(body, url, true), raw: body };
    }

    const detail = body.message ?? body.code ?? JSON.stringify(body).slice(0, 160);
    return { error: `YOURLS refused the request: ${detail}`, raw: body };
  },
};

export const yourls: Provider = asProvider(yourlsShortener);
