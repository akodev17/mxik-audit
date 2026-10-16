import { Onest } from 'next/font/google';

// Onest draws the Uzbek tutuq belgisi (U+02BB, U+02BC) in its latin subset.
export const onest = Onest({
  subsets: ['latin', 'latin-ext', 'cyrillic'],
  weight: ['400', '500', '700'],
  display: 'swap',
  variable: '--font-onest',
});
