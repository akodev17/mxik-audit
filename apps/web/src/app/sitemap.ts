import type { MetadataRoute } from 'next';
import { appOrigin } from '@tasnivo/domain/app-url';
import { HELP_ARTICLES, helpPath } from '@tasnivo/domain/help';

// Public pages only: the landing page and the help center in both languages.
export default function sitemap(): MetadataRoute.Sitemap {
  const origin = appOrigin();
  if (!origin) return [];
  const paths = ['/', helpPath('uz'), helpPath('ru'), ...HELP_ARTICLES.flatMap((a) => [helpPath('uz', a.slug), helpPath('ru', a.slug)])];
  return paths.map((path) => ({ url: `${origin}${path}` }));
}
