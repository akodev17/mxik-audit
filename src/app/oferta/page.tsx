import type { Metadata } from 'next';
import Link from 'next/link';
import { PRICING } from '@/components/landing/config';
import { LegalPage, Todo } from '@/components/landing/legal-page';

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

export default function OfferPage() {
  return (
    <LegalPage title="Ommaviy oferta" updated={<>15.10.2026 — <Todo>yurist koʻrib chiqqan sana</Todo></>}>
      <p>
        <Todo>Ushbu hujjat yurist tomonidan yozilishi yoki tekshirilishi kerak. Quyidagi
        tuzilma faqat qoralama.</Todo>
      </p>

      <section>
        <h2>1. Tomonlar</h2>
        <p className="mt-2">
          Ijrochi: <Todo>kompaniya nomi</Todo>, STIR <Todo>STIR</Todo>, manzil{' '}
          <Todo>yuridik manzil</Todo>, bank rekvizitlari <Todo>hisob raqami, bank, MFO</Todo>.
          Buyurtmachi — ushbu shartlarni qabul qilgan shaxs.
        </p>
      </section>

      <section>
        <h2>2. Xizmat</h2>
        <ul>
          <li>
            {PRICING.free.name} ({PRICING.free.price.toLowerCase()}): katalogdagi riskli
            MXIK pozitsiyalari roʻyxati.
          </li>
          {PRICING.plans.map((p) => (
            <li key={p.rows}>
              {PRICING.planName}, {p.rows}: {p.price} {PRICING.currency}.{' '}
              {PRICING.planDetail}.
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>3. Natijaning xarakteri</h2>
        <p className="mt-2">
          Ijrochi MXIK kodlarini tavsiya qiladi. Bitta tovar uchun yagona toʻgʻri kodni
          belgilaydigan hujjat yoʻq, shuning uchun natija kafolat emas: har bir kod
          boʻyicha yakuniy qarorni Buyurtmachi qabul qiladi.{' '}
          <Todo>javobgarlik chegarasi — yurist bilan</Todo>
        </p>
      </section>

      <section>
        <h2>4. Toʻlov va muddatlar</h2>
        <p className="mt-2">
          {PRICING.paymentNote} Bepul audit natijasi fayl olinganidan keyin bir ish kuni
          ichida yuboriladi. Pullik xizmat muddati: <Todo>muddat</Todo>.
        </p>
      </section>

      <section>
        <h2>5. Maʼlumotlar</h2>
        <p className="mt-2">
          Buyurtmachi maʼlumotlari{' '}
          <Link href="/maxfiylik" className="underline">maxfiylik siyosatiga</Link> muvofiq
          qayta ishlanadi.
        </p>
      </section>

      <section>
        <h2>6. Nizolar va boshqa shartlar</h2>
        <p className="mt-2">
          <Todo>nizolarni hal qilish tartibi, ofertani qabul qilish usuli, amal qilish muddati</Todo>
        </p>
      </section>
    </LegalPage>
  );
}
