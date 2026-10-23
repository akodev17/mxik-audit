'use client';

import { useState } from 'react';

type Period = 'monthly' | 'yearly';
type Price = { price: string; unit: string | null; note: string };

/** One plan as display text; pricing.tsx builds it from PRICING and the pricing dictionary. */
export type PlanCard = {
  key: string;
  name: string;
  who: string;
  /** The free plan: outlined in brand colour, with the "start here" badge and the primary button. */
  highlight: boolean;
  monthly: Price;
  yearly: Price;
  cta: { label: string; href: string };
  features: { label: string; on: boolean }[];
  limits: { label: string; value: string }[];
};

type Copy = {
  period: { label: string; monthly: string; yearly: string; yearlyBadge: string };
  forWhom: string;
  badge: string;
  included: string;
  excluded: string;
  limitsTitle: string;
};

function Mark({ on, copy }: { on: boolean; copy: Copy }) {
  return on ? (
    <>
      <svg aria-hidden="true" viewBox="0 0 20 20" className="size-5 shrink-0 text-lp-ok" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="10" cy="10" r="7.5" /><path d="m6.8 10.3 2.2 2.2 4.2-4.6" /></svg>
      <span className="sr-only">{copy.included}: </span>
    </>
  ) : (
    <>
      <svg aria-hidden="true" viewBox="0 0 20 20" className="size-5 shrink-0 text-lp-line-strong" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M6 10h8" /></svg>
      <span className="sr-only">{copy.excluded}: </span>
    </>
  );
}

// The monthly/yearly switch and the plan cards. Rendered monthly on the server; the switch only
// swaps which of the two prepared prices each card shows.
export function PricingPlans({ cards, copy }: { cards: PlanCard[]; copy: Copy }) {
  const [period, setPeriod] = useState<Period>('monthly');
  return (
    <>
      <fieldset className="mx-auto mt-10 flex w-fit rounded-full border border-lp-line bg-lp-base p-1">
        <legend className="sr-only">{copy.period.label}</legend>
        {(['monthly', 'yearly'] as const).map((p) => {
          const on = period === p;
          return (
            <label
              key={p}
              className={`flex min-h-10 cursor-pointer items-center gap-2 rounded-full px-4 text-[15px] font-medium transition-colors has-[input:focus-visible]:outline-3 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-lp-brand ${on ? 'bg-lp-brand text-white' : 'text-lp-ink hover:bg-lp-surface'}`}
            >
              <input type="radio" name="pricing-period" value={p} checked={on} onChange={() => setPeriod(p)} autoComplete="off" className="sr-only" />
              {copy.period[p]}
              {p === 'yearly' ? (
                <span className={`rounded-full px-2 py-0.5 text-[12px] font-medium ${on ? 'bg-white/20 text-white' : 'bg-lp-ok-fill text-lp-ok-ink'}`}>{copy.period.yearlyBadge}</span>
              ) : null}
            </label>
          );
        })}
      </fieldset>

      <ul className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((p) => {
          const price = p[period];
          return (
            <li
              key={p.key}
              className={`flex flex-col rounded-lp-lg bg-lp-base p-6 ${p.highlight ? 'border-2 border-lp-brand shadow-sm' : 'border border-lp-line'}`}
            >
              <div className="flex min-h-6 items-center justify-between gap-2">
                <h3 className="text-[18px] font-semibold">{p.name}</h3>
                {p.highlight ? <span className="rounded-full bg-lp-brand-fill px-2.5 py-0.5 text-[12px] font-medium text-lp-brand-ink">{copy.badge}</span> : null}
              </div>
              <p className="mt-2 text-[14px] sm:min-h-[4.5rem] text-lp-muted">
                <span className="font-medium text-lp-ink">{copy.forWhom}:</span> {p.who}
              </p>
              {/* Number, unit and note on their own lines, so a long yearly price never pushes the unit
                  under it in one card and beside it in the next. */}
              <p className="mt-3 whitespace-nowrap text-[30px] font-bold leading-none tracking-tight tabular-nums">{price.price}</p>
              <p className="mt-1.5 text-[15px] text-lp-muted sm:min-h-6">{price.unit}</p>
              <p className="text-[14px] text-lp-muted sm:min-h-[2.875rem]">{price.note}</p>
              <a
                href={p.cta.href}
                className={`mt-5 inline-flex min-h-11 items-center justify-center rounded-lp px-4 text-[15px] font-medium transition-colors ${p.highlight ? 'bg-lp-brand text-white hover:bg-lp-brand-ink' : 'border border-lp-line-strong bg-lp-base text-lp-ink hover:bg-lp-surface'}`}
              >
                {p.cta.label}
              </a>
              <ul className="mt-6 space-y-3 border-t border-lp-line pt-5 text-[15px]">
                {p.features.map((f) => (
                  <li key={f.label} className={`flex items-start gap-2.5 ${f.on ? 'text-lp-ink' : 'text-lp-muted'}`}>
                    <Mark on={f.on} copy={copy} />
                    {f.label}
                  </li>
                ))}
              </ul>
              <h4 className="mt-6 text-[13px] font-medium uppercase tracking-wide text-lp-muted">{copy.limitsTitle}</h4>
              <dl className="mt-2 space-y-1.5 text-[14px]">
                {p.limits.map((l) => (
                  <div key={l.label} className="flex items-baseline justify-between gap-3">
                    <dt className="text-lp-muted">{l.label}</dt>
                    <dd className="text-right font-medium tabular-nums">{l.value}</dd>
                  </div>
                ))}
              </dl>
            </li>
          );
        })}
      </ul>
    </>
  );
}
