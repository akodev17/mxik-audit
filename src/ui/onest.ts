import { Onest } from 'next/font/google';

// Onest draws the Uzbek tutuq belgisi (U+02BB, U+02BC) in its latin subset.
// 600 is the heading weight of the app type scale.
export const onest = Onest({
  subsets: ['latin', 'latin-ext', 'cyrillic'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  variable: '--font-onest',
});
