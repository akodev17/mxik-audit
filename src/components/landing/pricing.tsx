import { PRICING } from './config';
import { Chapter } from './primitives';

/** A price list, set like one: item, leader, amount. Every number and plan
 *  name comes from PRICING in config.ts. */
function Line({ item, detail, amount, unit, tone }: {
  item: React.ReactNode; detail: string; amount: string; unit?: string; tone?: 'ok';
}) {
  return (
    <div className="border-b border-rule py-4">
      <div className="flex items-baseline gap-3">
        <span className={`min-w-0 ${tone === 'ok' ? 'font-medium text-ok' : ''}`}>{item}</span>
        <span aria-hidden="true" className="mb-1 min-w-6 flex-1 border-b border-dotted border-rule-strong" />
        <span className={`shrink-0 font-serif text-[22px] tnum ${tone === 'ok' ? 'text-ok' : ''}`}>
          {amount}
          {unit ? <span className="ml-1.5 font-sans text-sm text-ink-soft">{unit}</span> : null}
        </span>
      </div>
      <p className="mt-0.5 text-[13px] text-ink-soft">{detail}</p>
    </div>
  );
}

export function Pricing() {
  return (
    <Chapter n="07" label="Narx" id="narxlar">
      <div className="grid grid-cols-1 gap-x-14 gap-y-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <div>
          <h2 className="text-[28px] leading-tight sm:text-[34px]">Narxlar</h2>
          <p className="mt-4 max-w-[44ch] text-ink-soft">
            Avval nechta pozitsiya riskli ekanini bepul koʻrasiz. Toʻgʻrilash kerakmi —
            shundan keyin oʻzingiz hal qilasiz.
          </p>
        </div>
        <div className="border-t border-ink">
          <Line item={PRICING.free.name} detail={PRICING.free.detail} amount={PRICING.free.price} tone="ok" />
          {PRICING.plans.map((p) => (
            <Line
              key={p.rows}
              item={<>{PRICING.planName} · <span className="font-medium">{p.rows}</span></>}
              detail={PRICING.planDetail}
              amount={p.price}
              unit={PRICING.currency}
            />
          ))}
          <p className="pt-3 text-[13px] text-ink-soft">{PRICING.paymentNote}</p>
        </div>
      </div>
    </Chapter>
  );
}
