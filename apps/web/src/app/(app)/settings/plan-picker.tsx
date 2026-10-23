'use client';

import { useState } from 'react';
import { cx } from '@/ui/cx';
import { PayButtons } from '@/ui/pay-buttons';
import { Segmented } from '@/ui/segmented';

type Period = 'monthly' | 'yearly';

export type TierChoice = {
  tier: string;
  name: string;
  who: string;
  /** Plan id and the price as text ("390 000 soʻm / oy") for each period. */
  monthly: { id: string; price: string };
  yearly: { id: string; price: string };
};

type Props = {
  tiers: TierChoice[];
  initialTier: string;
  initialPeriod: Period;
  labels: { period: string; monthly: string; yearly: string; tier: string };
  /** The providers to pay with; null when nothing can be paid here (the tab says why next to it). */
  providers: ('click' | 'payme')[] | null;
};

/** Pick a tier and monthly or yearly; the pay buttons start the checkout for exactly that plan id. */
export function PlanPicker({ tiers, initialTier, initialPeriod, labels, providers }: Props) {
  const [period, setPeriod] = useState<Period>(initialPeriod);
  const [tier, setTier] = useState(initialTier);
  const chosen = tiers.find((t) => t.tier === tier) ?? tiers[0];
  return (
    <div className="space-y-4">
      <Segmented
        label={labels.period}
        options={[{ value: 'monthly', label: labels.monthly }, { value: 'yearly', label: labels.yearly }]}
        value={period}
        onChange={setPeriod}
      />
      <fieldset>
        <legend className="sr-only">{labels.tier}</legend>
        <div className="grid gap-2 lg:grid-cols-3">
          {tiers.map((t) => {
            const on = t.tier === tier;
            return (
              <label
                key={t.tier}
                className={cx(
                  'flex cursor-pointer flex-col gap-1 rounded-md border px-3.5 py-3 transition-colors has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-brand',
                  on ? 'border-brand bg-brand-tint/40' : 'border-line bg-surface hover:border-line-strong',
                )}
              >
                <span className="flex items-center gap-2">
                  <input type="radio" name="plan-tier" value={t.tier} checked={on} onChange={() => setTier(t.tier)} className="size-4 accent-brand" />
                  <span className="text-small font-semibold">{t.name}</span>
                </span>
                <span className="text-micro text-muted">{t.who}</span>
                <span className="mt-1 text-data font-medium tabular-nums">{t[period].price}</span>
              </label>
            );
          })}
        </div>
      </fieldset>
      {providers && chosen ? <PayButtons planId={chosen[period].id} catalogId={null} providers={providers} /> : null}
    </div>
  );
}
