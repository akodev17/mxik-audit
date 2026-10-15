import { PRICING } from './config';

/** The price table. Every number and plan name comes from PRICING in config.ts. */
export function Pricing() {
  return (
    <div>
      <h2 className="text-[27px] leading-tight sm:text-[32px]">Narxlar</h2>
      <p className="mt-4 max-w-[52ch] text-ink-soft">
        Risk auditi — bepul: avval nechta pozitsiya muammoli ekanini koʻrasiz,
        keyin toʻgʻrilash kerak yoki yoʻqligini oʻzingiz hal qilasiz.
      </p>

      <div className="mt-8 border border-rule bg-paper">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-rule bg-ok-tint px-5 py-5 sm:px-6">
          <div>
            <p className="font-medium text-ok">{PRICING.free.name}</p>
            <p className="mt-0.5 text-[13px] text-ink-soft">{PRICING.free.detail}</p>
          </div>
          <p className="shrink-0 font-serif text-[22px] text-ok">{PRICING.free.price}</p>
        </div>

        {PRICING.plans.map((p) => (
          <div
            key={p.rows}
            className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-rule px-5 py-4 last:border-0 sm:px-6"
          >
            <div>
              <p>
                {PRICING.planName} — <span className="font-medium">{p.rows}</span>
              </p>
              <p className="mt-0.5 text-[13px] text-ink-soft">{PRICING.planDetail}</p>
            </div>
            <p className="shrink-0 font-serif text-[22px] tnum">
              {p.price} <span className="font-sans text-sm text-ink-soft">{PRICING.currency}</span>
            </p>
          </div>
        ))}
      </div>

      <p className="mt-4 text-[13px] text-ink-soft">{PRICING.paymentNote}</p>
    </div>
  );
}
