import type { Metadata } from 'next';
import Link from 'next/link';
import { fmtNumber } from '@tasnivo/i18n/format';
import { uz as pricingUz } from '@tasnivo/i18n/i18n-parts/pricing';
import { PRICING } from '@/components/landing/config';
import { Todo } from '@/components/landing/legal-page';
import { LegalDoc, type LegalSection } from '../maxfiylik/legal-doc';

/* A skeleton, not a contract. The service description, prices and payment
   terms are taken from the landing page itself (PRICING in config.ts) so the
   two cannot disagree; everything that needs a lawyer or company details is a
   TODO. Never fill those with guesses. */
export const metadata: Metadata = {
  title: 'Ommaviy oferta — Tasnivo',
  description: 'Tasnivo xizmatlari shartlari.',
  // Not indexed while it still carries TODO blanks.
  robots: { index: false, follow: true },
};

const c = pricingUz.prX;
const n = (v: number): string => fmtNumber('uz', v);

const SECTIONS: LegalSection[] = [
  {
    id: 'tomonlar',
    title: 'Tomonlar',
    body: (
      <p>
        Ijrochi: <Todo>kompaniya nomi</Todo>, STIR <Todo>STIR</Todo>, manzil{' '}
        <Todo>yuridik manzil</Todo>, bank rekvizitlari <Todo>hisob raqami, bank, MFO</Todo>.
        Buyurtmachi — ushbu shartlarni qabul qilgan shaxs.
      </p>
    ),
  },
  {
    id: 'xizmat',
    title: 'Xizmat',
    body: (
      <ul>
        <li>
          {c.names.trial} ({c.free.toLowerCase()}, {c.trialTerm(PRICING.trial.days)}): katalogdagi riskli
          MXIK pozitsiyalari roʻyxati va kod takliflari.
        </li>
        {PRICING.tiers.map((t) => (
          <li key={t.tier}>
            {c.names[t.tier]} obunasi: {n(t.monthly)} {c.currency} {c.perMonth} yoki{' '}
            {n(t.monthly * PRICING.yearlyPaidMonths)} {c.currency} {c.perYear}. {c.features.export}.
          </li>
        ))}
        {PRICING.catalog.map((t) => (
          <li key={t.maxRows}>
            {c.oneOff.title}, {c.oneOff.size(n(t.maxRows))}: {n(t.price)} {c.currency}. {c.oneOff.text}
          </li>
        ))}
      </ul>
    ),
  },
  {
    id: 'natija',
    title: 'Natijaning xarakteri',
    body: (
      <p>
        Ijrochi MXIK kodlarini tavsiya qiladi. Bitta tovar uchun yagona toʻgʻri kodni
        belgilaydigan hujjat yoʻq, shuning uchun natija kafolat emas: har bir kod
        boʻyicha yakuniy qarorni Buyurtmachi qabul qiladi.{' '}
        <Todo>javobgarlik chegarasi — yurist bilan</Todo>
      </p>
    ),
  },
  {
    id: 'tolov',
    title: 'Toʻlov va muddatlar',
    body: (
      <p>
        {c.payTransfer} Bepul audit natijasi fayl olinganidan keyin bir ish kuni
        ichida yuboriladi. Pullik xizmat muddati: <Todo>muddat</Todo>.
      </p>
    ),
  },
  {
    id: 'malumotlar',
    title: 'Maʼlumotlar',
    body: (
      <p>
        Buyurtmachi maʼlumotlari{' '}
        <Link href="/maxfiylik" className="underline">maxfiylik siyosatiga</Link> muvofiq
        qayta ishlanadi.
      </p>
    ),
  },
  {
    id: 'nizolar',
    title: 'Nizolar va boshqa shartlar',
    body: (
      <p>
        <Todo>nizolarni hal qilish tartibi, ofertani qabul qilish usuli, amal qilish muddati</Todo>
      </p>
    ),
  },
];

export default function OfferPage() {
  return (
    <LegalDoc
      title="Ommaviy oferta" updated={<>15.10.2026 — <Todo>yurist koʻrib chiqqan sana</Todo></>} sections={SECTIONS}
      intro={(
        <p>
          <Todo>Ushbu hujjat yurist tomonidan yozilishi yoki tekshirilishi kerak. Quyidagi
          tuzilma faqat qoralama.</Todo>
        </p>
      )}
    />
  );
}
