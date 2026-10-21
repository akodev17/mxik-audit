import { PRICING } from './config';
import { CONTAINER } from './container';

// Every row is a fact from PRICING in config.ts or from the free-audit flow; nothing here repeats a number.
type Plan = {
  key: string;
  name: string;
  price: string;
  unit: string | null;
  limit: string;
  cta: string;
  primary: boolean;
  /** Which feature rows the plan has, in FEATURES order. */
  has: readonly boolean[];
};

const FEATURES = [
  'Riskli pozitsiyalar roʻyxati',
  'Tasdiqlangan kodlar qoʻyilgan fayl',
  'Qarorlar tarixi',
] as const;

function plans(): Plan[] {
  return [
    { key: 'free', name: PRICING.free.name, price: 'Bepul', unit: null, limit: PRICING.free.detail, cta: 'Faylni bepul yuborish', primary: true, has: [true, false, false] },
    ...PRICING.plans.map((p): Plan => ({
      key: p.rows, name: PRICING.planName, price: p.price, unit: PRICING.currency, limit: p.rows, cta: 'Faylni yuborish', primary: false, has: [true, true, true],
    })),
  ];
}

function Mark({ on }: { on: boolean }) {
  return on ? (
    <>
      <svg aria-hidden="true" viewBox="0 0 20 20" className="size-5 shrink-0 text-lp-ok" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="10" cy="10" r="7.5" /><path d="m6.8 10.3 2.2 2.2 4.2-4.6" /></svg>
      <span className="sr-only">Kiradi: </span>
    </>
  ) : (
    <>
      <svg aria-hidden="true" viewBox="0 0 20 20" className="size-5 shrink-0 text-lp-line-strong" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M6 10h8" /></svg>
      <span className="sr-only">Kirmaydi: </span>
    </>
  );
}

// Free audit first, then the corrected catalogue by size. All four actions start with the same step: the file.
export function Pricing() {
  return (
    <section id="narxlar" aria-labelledby="pricing-title" className="bg-lp-surface py-20 sm:py-28">
      <div className={CONTAINER}>
        <div className="mx-auto max-w-[40rem] text-center">
          <p className="text-[13px] font-medium uppercase tracking-wide text-lp-brand-ink">Narxlar</p>
          <h2 id="pricing-title" className="lp-display mt-4 text-[clamp(1.875rem,3.8vw,2.75rem)]">Avval bepul koʻring, keyin hajmga qarab tanlang</h2>
          <p className="mt-4 text-[17px] text-lp-muted">
            Nechta pozitsiya riskli ekanini bepul koʻrasiz. Toʻgʻrilash kerakmi, shundan keyin oʻzingiz hal qilasiz.
          </p>
        </div>

        <ul className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {plans().map((p) => (
            <li
              key={p.key}
              className={`flex flex-col rounded-lp-lg bg-lp-base p-6 ${p.primary ? 'border-2 border-lp-brand shadow-sm' : 'border border-lp-line'}`}
            >
              <div className="flex min-h-6 items-center justify-between gap-2">
                <h3 className="text-[16px] font-semibold">{p.name}</h3>
                {p.primary ? <span className="rounded-full bg-lp-brand-fill px-2.5 py-0.5 text-[12px] font-medium text-lp-brand-ink">Boshlash uchun</span> : null}
              </div>
              <p className="mt-4 flex items-baseline gap-1.5">
                <span className="text-[34px] font-bold leading-none tracking-tight tabular-nums">{p.price}</span>
                {p.unit ? <span className="text-[15px] text-lp-muted">{p.unit}</span> : null}
              </p>
              <p className="mt-2 min-h-[3rem] text-[15px] text-lp-muted">{p.limit}</p>
              <a
                href="#audit"
                className={`mt-5 inline-flex min-h-11 items-center justify-center rounded-lp px-4 text-[15px] font-medium transition-colors ${p.primary ? 'bg-lp-brand text-white hover:bg-lp-brand-ink' : 'border border-lp-line-strong bg-lp-base text-lp-ink hover:bg-lp-surface'}`}
              >
                {p.cta}
              </a>
              <ul className="mt-6 space-y-3 border-t border-lp-line pt-5 text-[15px]">
                {FEATURES.map((label, i) => (
                  <li key={label} className={`flex items-start gap-2.5 ${p.has[i] ? 'text-lp-ink' : 'text-lp-muted'}`}>
                    <Mark on={p.has[i] ?? false} />
                    {label}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
        <p className="mx-auto mt-6 max-w-[48rem] text-center text-[14px] text-lp-muted">{PRICING.paymentNote}</p>
      </div>
    </section>
  );
}
