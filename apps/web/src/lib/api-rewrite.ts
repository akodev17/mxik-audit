// The web app's /api/* rewrite (apps/web/next.config.ts), kept apart so it can be tested without loading Next.

export type Rewrite = { source: string; destination: string };

/**
 * The /api/* rewrite, and one log line naming its destination (Q18): `next build` bakes it into the
 * build, so a production build made without API_INTERNAL_URL talks to localhost:4000 whatever
 * `next start` is given. The line makes a build against the wrong API visible in its output.
 */
export function apiRewrites(env: Record<string, string | undefined>, log: (line: string) => void = console.log): Rewrite[] {
  if (env['NEXT_PUBLIC_API_URL']) {
    log(`[next.config] /api/* is not rewritten: the browser calls NEXT_PUBLIC_API_URL (${env['NEXT_PUBLIC_API_URL']}) itself`);
    return [];
  }
  const set = env['API_INTERNAL_URL']?.trim();
  const api = (set || 'http://localhost:4000').replace(/\/$/, '');
  log(`[next.config] /api/* -> ${api}/api/* (${set ? 'API_INTERNAL_URL' : 'default, API_INTERNAL_URL not set'}); a production build keeps this destination, so set API_INTERNAL_URL when building`);
  return [{ source: '/api/:path*', destination: `${api}/api/:path*` }];
}
