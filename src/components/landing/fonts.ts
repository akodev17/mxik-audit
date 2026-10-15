import { Onest } from 'next/font/google';

// Onest draws ʻ and ʼ (U+02BB/U+02BC) narrow and has tabular figures.
export const onest = Onest({
  subsets: ['latin', 'latin-ext', 'cyrillic'],
  weight: ['400', '500', '700'],
  display: 'swap',
  variable: '--font-onest',
});
