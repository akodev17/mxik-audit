import type { Metadata } from 'next';
import { Consequences } from '@/components/landing/consequences';
import { GetStarted } from '@/components/landing/get-started';
import { Hero } from '@/components/landing/hero';
import { HowItWorks } from '@/components/landing/how-it-works';
import { Problem } from '@/components/landing/problem';
import { SampleReport } from '@/components/landing/sample-report';
import { SiteFooter } from '@/components/landing/site-footer';
import { SiteHeader } from '@/components/landing/site-header';
import { Trust } from '@/components/landing/trust';

export const metadata: Metadata = {
  title: 'MXIK Audit — katalogingizdagi xavfli MXIK kodlarini toping',
  description:
    'Excel yoki CSV katalogingizni yuklang, riskli MXIK pozitsiyalari roʻyxatini '
    + 'bepul oling. Tasniflagichda 438 925 kod bor — qoʻlda tekshirish real emas.',
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
        <Trust />
        <GetStarted />
      </main>
      <SiteFooter />
    </>
  );
}
