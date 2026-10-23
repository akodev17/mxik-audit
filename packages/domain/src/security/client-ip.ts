// The client address for rate limits. Behind the documented proxy (Caddy, infra/routes.caddy; or
// nginx) X-Real-IP is the connection's address and only the rightmost X-Forwarded-For hop was
// appended by the proxy; the leftmost is whatever the client sent. Without a proxy in front, both
// headers are the client's own words, so they are believed only when TRUST_PROXY says a proxy sets
// them (Q5); otherwise the caller uses the socket address. Unset, a production process
// (NODE_ENV=production) trusts no proxy, and a development one trusts it (dev servers, the e2e runs
// and the probes name their client in X-Real-IP, as Caddy would; a dev server is never public).
type HeaderBag = { get(name: string): string | null };
type Env = Record<string, string | undefined>;

const MAX_LENGTH = 64;

/**
 * TRUST_PROXY=1 (or true, yes, caddy, nginx): a proxy in front sets X-Real-IP / X-Forwarded-For;
 * 0 (or any other value): none does. Unset: trusted outside production only.
 */
export function trustProxy(env: Env = process.env): boolean {
  const value = env['TRUST_PROXY']?.trim().toLowerCase();
  if (!value) return env['NODE_ENV'] !== 'production';
  return value === '1' || value === 'true' || value === 'yes' || value === 'caddy' || value === 'nginx';
}

/** The proxy's client address, or 'unknown' when no proxy is trusted or none sent one (the caller then uses the socket's). */
export function clientIp(headers: HeaderBag, trusted: boolean = trustProxy()): string {
  if (!trusted) return 'unknown';
  const real = headers.get('x-real-ip')?.trim();
  if (real) return real.slice(0, MAX_LENGTH);
  const hops = (headers.get('x-forwarded-for') ?? '').split(',').map((h) => h.trim()).filter(Boolean);
  return hops[hops.length - 1]?.slice(0, MAX_LENGTH) ?? 'unknown';
}
