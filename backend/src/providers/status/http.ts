import axios, { type AxiosRequestConfig, type AxiosResponse } from 'axios';
import { config } from '../../config.js';

/**
 * GET a status endpoint with sensible defaults (UA + timeout) and one retry on
 * transient network errors. Public status endpoints occasionally reset the
 * connection (ECONNRESET/ETIMEDOUT); a single quick retry avoids spurious
 * "down" readings without meaningfully slowing the response.
 */
export async function statusGet<T = unknown>(
  url: string,
  options: AxiosRequestConfig = {},
): Promise<AxiosResponse<T>> {
  const cfg: AxiosRequestConfig = {
    timeout: config.serverTimeout,
    ...options,
    headers: { 'User-Agent': config.statusUserAgent, ...(options.headers || {}) },
  };

  try {
    return await axios.get<T>(url, cfg);
  } catch (error) {
    const code = (error as { code?: string })?.code;
    const transient =
      code === 'ECONNRESET' ||
      code === 'ETIMEDOUT' ||
      code === 'ECONNABORTED' ||
      code === 'EAI_AGAIN';
    if (!transient) throw error;
    await new Promise((r) => setTimeout(r, 300));
    return await axios.get<T>(url, cfg);
  }
}
