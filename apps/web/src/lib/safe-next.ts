// Where to land after sign-in when the link carries ?next=: only a path on this site. A copy of
// @tasnivo/domain/security/safe-next (safe-next.test.ts holds them together); the API applies the
// original to what the sign-in form posts.
const BASE = 'http://next.invalid';
const MAX_LENGTH = 512;

/** A same-origin path starting with a single '/', or null. Never '//host', '/\host', a scheme, control characters or the sign-in pages. */
export function safeNext(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_LENGTH) return null;
  if (!raw.startsWith('/') || raw.startsWith('//')) return null;
  // Browsers read a backslash as a slash, and strip tabs and newlines: refuse both.
  if (raw.includes('\\') || [...raw].some((ch) => ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) === 0x7f)) return null;
  let url: URL;
  try {
    url = new URL(raw, BASE);
  } catch {
    return null;
  }
  if (url.origin !== BASE) return null;
  if (url.pathname === '/sign-in' || url.pathname.startsWith('/sign-in/')) return null;
  return `${url.pathname}${url.search}${url.hash}`;
}
