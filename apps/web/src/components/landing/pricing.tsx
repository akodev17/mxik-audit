import Link from 'next/link';
import { fmtNumber } from '@tasnivo/i18n/format';
import { uz as pricingUz } from '@tasnivo/i18n/i18n-parts/pricing';
import { helpPath } from '@/lib/help';
import { ONLINE_PAYMENT, PRICING } from './config';
import { CONTAINER } from './container';
import { PricingPlans, type PlanCard } from './pricing-plans';

// Every number is from PRICING in config.ts (a checked copy of the domain's PLANS) and every word
// from the pricing dictionary; nothing here repeats either.
const c = pricingUz.prX;
const n = (v: number): string => fmtNumber('uz', v);
const cap = (v: number | null): string => (v === null ? c.unlimited : n(v));

type Limits = { clients: number | null; rowsPerMonth: number | null; seats: number | null };

function limitRows(limits: Limits, apiChecks: number | null): PlanCard['limits'] {
  return [
    { label: c.limits.clients, value: cap(limits.clients) },
    { label: c.limits.rows, value: cap(limits.rowsPerMonth) },
    { label: c.limits.seats, value: cap(limits.seats) },
    { label: c.limits.api, value: cap(apiChecks) },
  ];
}

/** Column of a plan in PRICING.features: Koʻrik, then the tiers in order. */
function features(column: number): PlanCard['features'] {
  return PRICING.features.map(([key, marks]) => ({ label: c.features[key], on: marks[column] ?? false }));
}

function cards(): PlanCard[] {
  const { trial } = PRICING;
  const freePrice = { price: c.free, unit: null, note: c.trialTerm(trial.days) };
  return [
    {
      key: 'trial', name: c.names.trial, who: c.who.trial, highlight: true,
      monthly: freePrice, yearly: freePrice,
      cta: { label: c.ctaFree, href: '/sign-up' },
      features: features(0), limits: limitRows(trial.limits, trial.apiChecks),
    },
    ...PRICING.tiers.map((t, i): PlanCard => {
      const yearly = t.monthly * PRICING.yearlyPaidMonths;
      return {
        key: t.tier, name: c.names[t.tier], who: c.who[t.tier], highlight: false,
        monthly: { price: n(t.monthly), unit: `${c.currency} ${c.perMonth}`, note: c.monthlyEquivalent(n(Math.round(yearly / 12))) },
        yearly: { price: n(yearly), unit: `${c.currency} ${c.perYear}`, note: c.yearlyEquivalent(n(Math.round(yearly / 12))) },
        cta: { label: c.ctaPaid, href: '/sign-up' },
        features: features(i + 1), limits: limitRows(t.limits, t.apiChecks),
      };
    }),
  ];
}

// The free check first, then the three subscriptions (monthly or yearly), then the one-off
// corrected catalogue for a company that does not want a subscription. Explanations of each
// feature live in the help article, linked once under the cards.
export function Pricing() {
  return (
    <section id="narxlar" aria-labelledby="pricing-title" className="bg-lp-surface py-20 sm:py-28">
      <div className={CONTAINER}>
        <div className="mx-auto max-w-[40rem] text-center">
          <p className="text-[13px] font-medium uppercase tracking-wide text-lp-brand-ink">{c.eyebrow}</p>
          <h2 id="pricing-title" className="lp-display mt-4 text-[clamp(1.875rem,3.8vw,2.75rem)]">{c.title}</h2>
          <p className="mt-4 text-[17px] text-lp-muted">{c.lead}</p>
        </div>

        <PricingPlans
          cards={cards()}
          copy={{ period: c.period, forWhom: c.forWhom, badge: c.startBadge, included: c.included, excluded: c.excluded, limitsTitle: c.limitsTitle }}
        />

        <p className="mt-4 text-center text-[15px]">
          <Link href={helpPath('uz', 'tariflar-va-limitlar')} className="font-medium text-lp-brand-ink underline decoration-2 underline-offset-4">{c.details}</Link>
        </p>

        <div className="mt-6 flex flex-col gap-5 rounded-lp-lg border border-lp-line bg-lp-base p-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-[26rem]">
            <p className="text-[13px] font-medium uppercase tracking-wide text-lp-muted">{c.oneOff.kicker}</p>
            <h3 className="mt-1 text-[18px] font-semibold">{c.oneOff.title}</h3>
            <p className="mt-2 text-[15px] text-lp-muted">{c.oneOff.text}</p>
          </div>
          <ul className="grid gap-2 sm:grid-cols-3 lg:min-w-[32rem]">
            {PRICING.catalog.map((t) => (
              <li key={t.maxRows} className="rounded-lp border border-lp-line px-4 py-3">
                <p className="whitespace-nowrap text-[14px] text-lp-muted">{c.oneOff.size(n(t.maxRows))}</p>
                <p className="mt-0.5 whitespace-nowrap text-[18px] font-semibold tabular-nums">
                  {n(t.price)} <span className="text-[14px] font-normal text-lp-muted">{c.currency}</span>
                </p>
              </li>
            ))}
          </ul>
          <a
            href="#audit"
            className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-lp border border-lp-line-strong bg-lp-base px-5 text-[15px] font-medium text-lp-ink transition-colors hover:bg-lp-surface"
          >
            {c.oneOff.cta}
          </a>
        </div>
        <p className="mx-auto mt-6 max-w-[48rem] text-center text-[14px] text-lp-muted">
          {c.oneOff.larger} {c.payTransfer}{ONLINE_PAYMENT ? ` ${c.payOnline}` : ''}
        </p>
      </div>
    </section>
  );
}
