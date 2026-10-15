import type { Metadata } from 'next';
import { Consequences } from '@/components/landing/consequences';
import { Deliverables } from '@/components/landing/deliverables';
import { Evidence } from '@/components/landing/evidence';
import { Hero } from '@/components/landing/hero';
import { LeadSection } from '@/components/landing/lead-section';
import { Pricing } from '@/components/landing/pricing';
import { Problem } from '@/components/landing/problem';
import { SampleReport } from '@/components/landing/sample-report';
import { SiteFooter } from '@/components/landing/site-footer';
import { SiteHeader } from '@/components/landing/site-header';
import { Steps } from '@/components/landing/steps';
import { Trust } from '@/components/landing/trust';

export const metadata: Metadata = {
  title: 'MXIK Audit — katalogingizdagi xavfli MXIK kodlarini toping',
  description:
    'Excel yoki CSV katalogingizni yuklang, riskli MXIK pozitsiyalari roʻyxatini '
    + 'bepul oling. Tasniflagichda 438 925 kod bor — qoʻlda tekshirish real emas.',
};

/* Each section lives in src/components/landing/, one file per section. Shared
   figures, constants and their sources are in data.ts and figures.tsx there. */
export default function LandingPage() {
  return (
    <>
      <SiteHeader />
      <main>
        <Hero />
        <Problem />
        <Evidence />
        <Consequences />
        <Steps />
        <SampleReport />
        <Deliverables />
        <Trust />
        <Pricing />
        <LeadSection />
      </main>
      <SiteFooter />
    </>
  );
}
