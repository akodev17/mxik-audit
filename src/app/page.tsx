import type { Metadata } from 'next';
import { AccountantsTrust } from '@/components/landing/accountants-trust';
import { DEMO_URL, SITE_URL } from '@/components/landing/config';
import { Consequences } from '@/components/landing/consequences';
import { GetStarted } from '@/components/landing/get-started';
import { Hero } from '@/components/landing/hero';
import { HowItWorks } from '@/components/landing/how-it-works';
import { LandingShell } from '@/components/landing/shell';
import { StickyCta } from '@/components/landing/sticky-cta';
import { WhyCodes } from '@/components/landing/why-codes';

const TITLE = 'Tasnivo — katalogingizdagi xavfli MXIK kodlarini toping';
const DESCRIPTION =
  'Excel yoki CSV katalogni yuklang: har bir qator rasmiy MXIK tasniflagichi bilan '
  + 'solishtiriladi, xato kodlar ajratiladi va mos kod taklif qilinadi. Risk auditi bepul.';

export const metadata: Metadata = {
  ...(SITE_URL ? { alternates: { canonical: '/' } } : {}),
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    type: 'website',
    locale: 'uz_UZ',
    siteName: 'Tasnivo',
    title: TITLE,
    description: DESCRIPTION,
  },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
};

// Six sections: hero with live scan, why codes mislead, consequences, steps, accountants and data, price and form.
export default function LandingPage() {
  return (
    <LandingShell>
      <Hero />
      <WhyCodes />
      <Consequences />
      <HowItWorks />
      <AccountantsTrust />
      <GetStarted />
      <StickyCta
        href={DEMO_URL ?? '#audit'}
        label={DEMO_URL ? 'Demoni ochish' : 'Faylni bepul tekshirtirish'}
      />
    </LandingShell>
  );
}
