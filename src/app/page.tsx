import type { Metadata } from 'next';

import { DEMO_URL, SITE_URL } from '@/components/landing/config';
import { Consequences } from '@/components/landing/consequences';
import { DemoBand } from '@/components/landing/demo-band';
import { Outcomes } from '@/components/landing/outcomes';
import { Problem } from '@/components/landing/problem';
import { Trust } from '@/components/landing/trust';
import { Workflow } from '@/components/landing/workflow';
import { GetStarted } from '@/components/landing/get-started';
import { Hero } from '@/components/landing/hero';

import { LandingShell } from '@/components/landing/shell';
import { StickyCta } from '@/components/landing/sticky-cta';


const TITLE = 'Tasnivo — katalogdagi MXIK kodlarini tekshiring va qarorni izli qiling';
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

// Hero, problem, consequences, live demo, workflow, outcomes, trust, price with questions, closing form.
export default function LandingPage() {
  return (
    <LandingShell>
      <Hero />
      <Problem />
      <Consequences />
      <DemoBand />
      <Workflow />
      <Outcomes />
      <Trust />
      <GetStarted />
      <StickyCta
        href={DEMO_URL ?? '#audit'}
        label={DEMO_URL ? 'Demoni ochish' : 'Faylni bepul tekshirtirish'}
      />
    </LandingShell>
  );
}
