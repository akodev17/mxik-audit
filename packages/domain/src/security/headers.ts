// HTTP security headers for every route, wired in next.config.ts.
// script-src keeps 'unsafe-inline': Next.js bootstraps each page with inline scripts, and nonces
// would need middleware on every request plus a verified production build (DEPLOY.md 7g).
type Env = Record<string, string | undefined>;
export type Header = { key: string; value: string };

export function contentSecurityPolicy(dev: boolean): string {
  const directives: [string, string[]][] = [
    ['default-src', ["'self'"]],
    // The Telegram Login Widget script; webpack's dev runtime needs eval.
    ['script-src', ["'self'", "'unsafe-inline'", 'https://telegram.org', ...(dev ? ["'unsafe-eval'"] : [])]],
    // React style attributes and Next.js style tags.
    ['style-src', ["'self'", "'unsafe-inline'"]],
    ['img-src', ["'self'", 'data:', 'blob:', 'https://t.me', 'https://telegram.org']],
    ['font-src', ["'self'", 'data:']],
    // Hot reload talks over a websocket in development.
    ['connect-src', ["'self'", ...(dev ? ['ws:', 'wss:'] : [])]],
    // The Telegram widget's button is an iframe.
    ['frame-src', ['https://oauth.telegram.org']],
    ['frame-ancestors', ["'none'"]],
    ['base-uri', ["'self'"]],
    ['object-src', ["'none'"]],
  ];
  return directives.map(([name, values]) => `${name} ${values.join(' ')}`).join('; ');
}

export function securityHeaders(env: Env = process.env): Header[] {
  const production = env['NODE_ENV'] === 'production';
  return [
    { key: 'Content-Security-Policy', value: contentSecurityPolicy(!production) },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
    { key: 'X-Frame-Options', value: 'DENY' },
    // Browsers ignore HSTS over plain HTTP, but local `next start` is never told to pin anything.
    ...(production ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000' }] : []),
  ];
}
