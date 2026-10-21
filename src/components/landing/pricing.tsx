import { PRICING } from './config';

// Price list from PRICING in config.ts; nothing here repeats a number.
export function Pricing() {
  return (
    <div>
      <h2 id="narxlar" className="lp-display scroll-mt-6 text-[clamp(1.75rem,3.4vw,2.25rem)]">Narxlar</h2>
      <p className="mt-4 max-w-[36rem] text-[18px] text-lp-muted">
        Avval nechta pozitsiya riskli ekanini bepul koʻrasiz. Toʻgʻrilash kerakmi, shundan keyin
        oʻzingiz hal qilasiz.
      </p>
      <ul className="mt-8 border-t border-lp-line">
        <li className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-lp-line py-5">
          <span>
            <span className="block text-[20px] font-bold">{PRICING.free.name}</span>
            <span className="block text-[16px] text-lp-muted">{PRICING.free.detail}</span>
          </span>
          <span className="text-[26px] font-bold">Bepul</span>
        </li>
        {PRICING.plans.map((p) => (
          <li key={p.rows} className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-lp-line py-5">
            <span>
              <span className="block text-[20px] font-bold">{PRICING.planName}, {p.rows}</span>
              <span className="block text-[16px] text-lp-muted">{PRICING.planDetail}</span>
            </span>
            <span className="num text-[26px] font-bold">
              {p.price} <span className="text-[17px] font-medium text-lp-muted">{PRICING.currency}</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-[16px] text-lp-muted">{PRICING.paymentNote}</p>
    </div>
  );
}
