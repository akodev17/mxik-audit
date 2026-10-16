import type { Metadata } from 'next';
import { Accountants } from '@/components/landing/accountants';
import { SITE_URL } from '@/components/landing/config';
import { Consequences } from '@/components/landing/consequences';
import { GetStarted } from '@/components/landing/get-started';
import { Hero } from '@/components/landing/hero';
import { HowItWorks } from '@/components/landing/how-it-works';
import { Problem } from '@/components/landing/problem';
import { SampleReport } from '@/components/landing/sample-report';
import { SiteFooter } from '@/components/landing/site-footer';
import { SiteHeader } from '@/components/landing/site-header';
import { Trust } from '@/components/landing/trust';

const TITLE = 'MXIK Audit — katalogingizdagi xavfli MXIK kodlarini toping';
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
    siteName: 'MXIK Audit',
    title: TITLE,
    description: DESCRIPTION,
  },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
};

/* Each section lives in src/components/landing/, one file per section. Shared
   figures, constants and their sources are in data.ts and figures.tsx there;
   flags and prices in config.ts. */
export default function LandingPage() {
  return (
    <>
      <SiteHeader />
      <main>
        <Hero />
        <Problem />
        <Consequences />
        <HowItWorks />
        <SampleReport />
        <Accountants />
        <Trust />
        <GetStarted />
      </main>
      <SiteFooter />
    </>
  );
}
