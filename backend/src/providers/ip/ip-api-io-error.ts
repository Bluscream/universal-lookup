import axios from 'axios';

/**
 * Turn an ip-api.io failure into something actionable.
 *
 * Five providers across two lookup types share one API key, so when that key
 * expires all five report `Request failed with status code 401` at once and
 * nothing connects that to IP_API_IO_KEY. The remedy is configuration, not a
 * retry, and the error should say so — the same reason the downdetector provider
 * special-cases its own 401.
 */
export function ipApiIoError(error: unknown): string {
  const status = axios.isAxiosError(error) ? error.response?.status : undefined;
  if (status === 401 || status === 403) {
    return `ip-api.io rejected the API key (HTTP ${status}) — check IP_API_IO_KEY`;
  }
  if (status === 429) {
    return 'ip-api.io rate limit or quota exhausted (HTTP 429) — check the IP_API_IO_KEY plan';
  }
  return error instanceof Error ? error.message : String(error);
}
