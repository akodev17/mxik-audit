import type { Metadata, Viewport } from 'next';
import { IBM_Plex_Mono } from 'next/font/google';
import { SITE_URL } from '@/components/landing/config';
import { getI18n, getLocale } from '@/lib/locale';
import { onest } from '@/ui/onest';
import './globals.css';

// Self-hosted by next/font at build time: no runtime request to Google, and no
// flash of fallback text. Product names mix scripts: Gate 0 found 23% of the
// "Latin" classifier export carries Cyrillic brand names inside otherwise Latin
// strings, so body (Onest) and code text must not fall back mid-word.
const plexMono = IBM_Plex_Mono({
  subsets: ['latin', 'cyrillic'],
  weight: ['400', '500'],
  display: 'swap',
  variable: '--font-plex-mono',
});

// Pages set their own "<page> — Tasnivo" titles, so there is no template here (it would repeat the name).
export async function generateMetadata(): Promise<Metadata> {
  const { locale, t } = await getI18n();
  return {
    // Absolute base for every route's Open Graph image (NEXT_PUBLIC_SITE_URL);
    // without it Telegram shows no link preview in production.
    ...(SITE_URL ? { metadataBase: SITE_URL } : {}),
    title: { default: `${t.appName} — ${t.tagline}`, template: '%s' },
    description: t.tagline,
    openGraph: { locale: locale === 'ru' ? 'ru_RU' : 'uz_UZ', siteName: t.appName },
  };
}

// Most of this audience arrives from a Telegram in-app browser.
export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang={await getLocale()} className={`${onest.variable} ${plexMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
