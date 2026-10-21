import type { Metadata } from 'next';

import { DEMO_URL, SITE_URL } from '@/components/landing/config';
import { Consequences } from '@/components/landing/consequences';
import { DemoBand } from '@/components/landing/demo-band';
import { Capabilities } from '@/components/landing/capabilities';
import { Faq } from '@/components/landing/faq';
import { FinalCta } from '@/components/landing/final-cta';
import { Outcomes } from '@/components/landing/outcomes';
import { Problem } from '@/components/landing/problem';
import { Trust } from '@/components/landing/trust';
import { Workflow } from '@/components/landing/workflow';
import { Pricing } from '@/components/landing/pricing';
import { Hero } from '@/components/landing/hero';

import { LandingShell } from '@/components/landing/shell';
import { StickyCta } from '@/components/landing/sticky-cta';


const TITLE = 'Tasnivo — MXIK katalogingizni tekshiring, xatolarni aniqlang';
const DESCRIPTION =
  'Mahsulot katalogingizdagi MXIK kodlari, oʻlchov birliklari va boshqa nomuvofiqliklarni aniqlang. '
  + 'Har bir tekshiruv natijasini tushunarli izoh va audit tarixi bilan koʻring. Risk auditi bepul.';

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

// Hero with the product, problem, consequences, capabilities, live demo, workflow, outcomes, trust, pricing, questions, closing form.
export default function LandingPage() {
  return (
    <LandingShell>
      <Hero />
      <Problem />
      <Consequences />
      <Capabilities />
      <DemoBand />
      <Workflow />
      <Outcomes />
      <Trust />
      <Pricing />
      <Faq />
      <FinalCta />
      <StickyCta
        href={DEMO_URL ?? '#audit'}
        label={DEMO_URL ? 'Demoni ochish' : 'Faylni bepul tekshirtirish'}
      />
    </LandingShell>
  );
}
