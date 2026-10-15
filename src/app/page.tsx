import type { Metadata } from 'next';
import { Accountants } from '@/components/landing/accountants';
import { Anatomy } from '@/components/landing/anatomy';
import { SITE_URL } from '@/components/landing/config';
import { Consequences } from '@/components/landing/consequences';
import { GetStarted } from '@/components/landing/get-started';
import { Opening } from '@/components/landing/opening';
import { Pricing } from '@/components/landing/pricing';
import { SiteFooter } from '@/components/landing/site-footer';
import { SiteHeader } from '@/components/landing/site-header';
import { Trust } from '@/components/landing/trust';
import { Workflow } from '@/components/landing/workflow';

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

/* One audit, told in order: the result itself (01, explorable), one risky row
   opened level by level (02), why it matters (03), how a finding becomes a
   corrected file (04), who it is for (05), what it does not promise and where
   the data goes (06), price (07), and the two real ways to start (08). Each
   chapter lives in src/components/landing/; facts and their sources in
   data.ts, flags and prices in config.ts. */
export default function LandingPage() {
  return (
    <>
      <SiteHeader />
      <main>
        <Opening />
        <Anatomy />
        <Consequences />
        <Workflow />
        <Accountants />
        <Trust />
        <Pricing />
        <GetStarted />
      </main>
      <SiteFooter />
    </>
  );
}
