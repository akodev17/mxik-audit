import type { Metadata, Viewport } from 'next';
import { IBM_Plex_Mono, IBM_Plex_Sans, Newsreader } from 'next/font/google';
import { t } from '@/lib/i18n';
import './globals.css';

// Self-hosted by next/font at build time: no runtime request to Google, and no
// flash of fallback text. Headings are Uzbek Latin only, so the serif needs no
// Cyrillic — but product names do: Gate 0 found 23% of the "Latin" classifier
// export carries Cyrillic brand names inside otherwise Latin strings, so body
// and code text must not fall back mid-word.
const newsreader = Newsreader({
  subsets: ['latin', 'latin-ext'],
  weight: ['400', '500', '600'],
  display: 'swap',
  variable: '--font-newsreader',
});

const plexSans = IBM_Plex_Sans({
  subsets: ['latin', 'latin-ext', 'cyrillic'],
  weight: ['400', '500', '600'],
  display: 'swap',
  variable: '--font-plex-sans',
});

const plexMono = IBM_Plex_Mono({
  subsets: ['latin', 'cyrillic'],
  weight: ['400', '500'],
  display: 'swap',
  variable: '--font-plex-mono',
});

export const metadata: Metadata = {
  title: `${t.appName} — ${t.tagline}`,
  description: t.tagline,
};

// Most of this audience arrives from a Telegram in-app browser.
export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="uz"
      className={`${newsreader.variable} ${plexSans.variable} ${plexMono.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
