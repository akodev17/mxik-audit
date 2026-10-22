// Public origin of the app, for links in emails and messages.
export function appOrigin(env: Record<string, string | undefined> = process.env): string | null {
  const raw = (env['APP_URL'] ?? env['NEXT_PUBLIC_SITE_URL'])?.trim().replace(/\/+$/, '');
  return raw && /^https?:\/\//.test(raw) ? raw : null;
}

/** Absolute link when an origin is configured, otherwise the site-relative path. */
export function absoluteUrl(path: string): string {
  const origin = appOrigin();
  return origin ? `${origin}${path}` : path;
}
