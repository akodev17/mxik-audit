import type { MetadataRoute } from 'next';
import { appOrigin } from '@/lib/pure/app-url';

/** Signed-in pages, token links and the API: nothing a search engine should list (B16). */
export const PRIVATE_PATHS = [
  '/dashboard', '/catalogs', '/clients', '/queue', '/activity', '/notifications', '/dictionary', '/team',
  '/upload', '/settings', '/admin', '/review', '/report', '/export', '/account-deleted', '/styleguide',
  '/bank', '/didox', '/products', '/onec', '/coming-soon',
  '/r/', '/invite/', '/reset/', '/demo/verify/', '/api/',
] as const;

// Public pages (landing, help, legal, pricing, demo request) are allowed; the sitemap lists them.
export default function robots(): MetadataRoute.Robots {
  const origin = appOrigin();
  return {
    rules: { userAgent: '*', allow: '/', disallow: [...PRIVATE_PATHS] },
    ...(origin ? { sitemap: `${origin}/sitemap.xml`, host: origin } : {}),
  };
}
