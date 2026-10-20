import { Instrument_Serif, Onest } from 'next/font/google';

// Onest draws ʻ and ʼ (U+02BB/U+02BC) narrow and has tabular figures.
export const onest = Onest({
  subsets: ['latin', 'latin-ext', 'cyrillic'],
  weight: ['400', '500', '700'],
  display: 'swap',
  variable: '--font-onest',
});

// Display face for landing headlines (class .lp-serif). Latin only: Uzbek Latin copy, never the
// Russian help articles, so those keep Onest.
export const display = Instrument_Serif({
  subsets: ['latin', 'latin-ext'],
  weight: '400',
  style: ['normal', 'italic'],
  display: 'swap',
  variable: '--font-display',
});
