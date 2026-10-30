// Which 1C hosts the server may call, and a fetch that connects only to the address that was
// checked (F20). Resolving the name for the check and letting fetch resolve it again opened a DNS
// rebinding window: a name could answer a public address to the check and 127.0.0.1 to fetch. The
// pinned fetch below hands Node's HTTP client the checked address as its lookup result, so the
// connection goes there while the Host header and TLS name stay the configured host.
import { lookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { BlockList, isIP, type LookupFunction } from 'node:net';

/** Loopback, private, shared, link-local, benchmark, documentation, multicast and reserved ranges. */
const RESERVED = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
  ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) RESERVED.addSubnet(net, prefix, 'ipv4');
for (const [net, prefix] of [
  ['::', 128], ['::1', 128],
  // IPv4-compatible ::a.b.c.d (deprecated) reaches an IPv4 address too; the whole ::/96 is refused.
  ['::', 96], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['2001:db8::', 32],
  // NAT64 prefixes reach any IPv4 address through a gateway, private ones included.
  ['64:ff9b::', 96], ['64:ff9b:1::', 48],
] as const) RESERVED.addSubnet(net, prefix, 'ipv6');

/** True for an address the server must not call (an IPv4-mapped IPv6 address is judged as its IPv4); anything not an IP too. */
export function privateAddress(ip: string): boolean {
  const version = isIP(ip);
  if (version === 0) return true;
  return RESERVED.check(ip, version === 4 ? 'ipv4' : 'ipv6');
}

export type Resolve = (host: string) => Promise<readonly { address: string; family: number }[]>;
const systemResolve: Resolve = (host) => lookup(host, { all: true });

type Env = Record<string, string | undefined>;

/**
 * A body past this is refused, never cut: a real base's $metadata runs past 10 MB (odata.ts reads up to 20 MB),
 * and its EntityContainer comes last, so a cut document parsed to no entity sets at all (review 30 Oct).
 */
export const RESPONSE_CAP = 32 * 1024 * 1024;

/**
 * The fetch to use for a 1C base URL, or null when the host is refused. A SaaS must not become a
 * proxy into its own network: in production every address the name resolves to must be public
 * unless ONEC_ALLOW_PRIVATE_HOSTS=1 (a self-hosted install next to the client's 1C), and the
 * connection is pinned to the first checked address. Development and tests use `base` unchecked.
 */
export async function hostFetcher(baseUrl: string, env: Env = process.env, resolve: Resolve = systemResolve, base: typeof fetch = fetch): Promise<typeof fetch | null> {
  if (env['NODE_ENV'] !== 'production') return base;
  const host = new URL(baseUrl).hostname.replace(/^\[|\]$/g, '');
  let addresses: readonly { address: string; family: number }[];
  try {
    addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await resolve(host);
  } catch {
    return null;
  }
  const first = addresses[0];
  if (!first) return null;
  if (env['ONEC_ALLOW_PRIVATE_HOSTS'] !== '1' && addresses.some((a) => privateAddress(a.address))) return null;
  return pinnedFetch(first.address, first.family === 6 ? 6 : 4);
}

/** Whether the server may call this host (hostFetcher without keeping the fetch). */
export async function hostAllowed(baseUrl: string, env: Env = process.env, resolve: Resolve = systemResolve): Promise<boolean> {
  return (await hostFetcher(baseUrl, env, resolve)) !== null;
}

/** fetch's failure shape, so callers read `cause.code` as before; an abort or timeout stays as it is. */
function fetchFailed(error: Error): Error {
  return error.name === 'AbortError' || error.name === 'TimeoutError' ? error : new TypeError('fetch failed', { cause: error });
}

/**
 * A fetch over Node's http/https that connects to `address` whatever the URL's host resolves to.
 * Covers what the 1C calls use: method, headers, a string body, signal; redirects are not followed.
 */
export function pinnedFetch(address: string, family: 4 | 6): typeof fetch {
  const pinned: LookupFunction = (_host, options, callback) => {
    if (options.all) (callback as unknown as (e: null, all: { address: string; family: number }[]) => void)(null, [{ address, family }]);
    else callback(null, address, family);
  };
  return (input, init = {}) => new Promise<Response>((resolve, reject) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const client = url.protocol === 'https:' ? https : http;
    const req = client.request(url, {
      method: init.method ?? 'GET',
      headers: Object.fromEntries(new Headers(init.headers).entries()),
      lookup: pinned,
      ...(init.signal ? { signal: init.signal } : {}),
    }, (res) => {
      const chunks: Buffer[] = [];
      let size = 0;
      const finish = (): void => {
        const status = res.statusCode ?? 502;
        const bytes = Buffer.concat(chunks);
        const headers = new Headers();
        for (const [name, value] of Object.entries(res.headers)) for (const one of [value ?? []].flat()) headers.append(name, one);
        const nullBody = [101, 204, 205, 304].includes(status);
        resolve(new Response(nullBody ? null : new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength), { status, headers }));
      };
      res.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size <= RESPONSE_CAP) chunks.push(chunk);
        else {
          res.removeAllListeners('end');
          res.destroy();
          reject(fetchFailed(new Error(`response larger than ${RESPONSE_CAP} bytes`)));
        }
      });
      res.on('end', finish);
      res.on('error', (error) => reject(fetchFailed(error)));
    });
    req.on('error', (error) => reject(fetchFailed(error)));
    if (typeof init.body === 'string') req.write(init.body);
    req.end();
  });
}
