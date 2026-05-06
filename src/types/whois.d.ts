declare module 'whois' {
  interface WhoisOptions {
    server?: string;
    follow?: number;
    timeout?: number;
    verbose?: boolean;
  }

  function lookup(
    address: string,
    options: WhoisOptions,
    callback: (err: Error | null, data: string) => void,
  ): void;

  function lookup(address: string, callback: (err: Error | null, data: string) => void): void;

  export { lookup };
  export default { lookup };
}
