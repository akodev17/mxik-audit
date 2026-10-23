// Public origin of the site (domain app-url.ts appOrigin), for the sitemap.
export function appOrigin(env: Record<string, string | undefined> = process.env): string | null {
  const raw = (env['APP_URL'] ?? env['NEXT_PUBLIC_SITE_URL'])?.trim().replace(/\/+$/, '');
  return raw && /^https?:\/\//.test(raw) ? raw : null;
}
