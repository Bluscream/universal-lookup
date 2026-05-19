declare module 'cloudscraper' {
  export interface CloudscraperGetOptions {
    url: string;
    headers?: Record<string, string>;
    timeout?: number;
  }

  export interface CloudscraperResponse {
    statusCode: number;
  }

  export type CloudscraperCallback = (
    error: Error | null,
    response: CloudscraperResponse,
    body: string,
  ) => void;

  export interface CloudscraperClient {
    get(options: CloudscraperGetOptions, callback: CloudscraperCallback): void;
  }

  const cloudscraper: CloudscraperClient;
  export default cloudscraper;
}
