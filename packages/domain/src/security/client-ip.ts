// The client address for rate limits. nginx (DEPLOY.md, section 6) sets X-Real-IP from
// $remote_addr and appends $remote_addr to X-Forwarded-For, so only the rightmost hop is
// trustworthy; the leftmost is whatever the client sent.
type HeaderBag = { get(name: string): string | null };

const MAX_LENGTH = 64;

export function clientIp(headers: HeaderBag): string {
  const real = headers.get('x-real-ip')?.trim();
  if (real) return real.slice(0, MAX_LENGTH);
  const hops = (headers.get('x-forwarded-for') ?? '').split(',').map((h) => h.trim()).filter(Boolean);
  return hops[hops.length - 1]?.slice(0, MAX_LENGTH) ?? 'unknown';
}
