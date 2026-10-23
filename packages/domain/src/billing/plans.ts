// Plans in one place: the free trial, the three subscription tiers (monthly or yearly) with their
// prices and limits, and the one-off corrected-catalogue tiers. The landing page repeats these
// numbers as display text (PRICING in apps/web/src/components/landing/config.ts) and
// tests/pricing-parity.test.ts fails when the two differ. Display names live in
// packages/i18n/src/i18n-parts/pricing.ts; the ids below never change with a rename.
// Proposal and reasons: docs/PRICING_PROPOSAL.md. Prices are in whole soʻm.
import type { Limits } from './limits';

export const TIERS = ['company', 'accountant', 'firm'] as const;
export type Tier = (typeof TIERS)[number];

export const PERIODS = ['monthly', 'yearly'] as const;
export type Period = (typeof PERIODS)[number];

/** A year costs this many months ("2 oy bepul"). */
export const YEARLY_PAID_MONTHS = 10;
const PERIOD_MONTHS: Record<Period, number> = { monthly: 1, yearly: 12 };

type TierDef = { monthly: number; limits: Limits; apiChecks: number | null };

export const PLANS = {
  trial: { days: 14, limits: { clients: 3, rowsPerMonth: 5_000, seats: 2 }, apiChecks: 500 },
  tiers: {
    company: { monthly: 390_000, limits: { clients: 1, rowsPerMonth: 20_000, seats: 3 }, apiChecks: 1_000 },
    accountant: { monthly: 900_000, limits: { clients: 10, rowsPerMonth: 50_000, seats: 5 }, apiChecks: 10_000 },
    firm: { monthly: 1_800_000, limits: { clients: null, rowsPerMonth: 200_000, seats: 10 }, apiChecks: 50_000 },
  } satisfies Record<Tier, TierDef>,
  catalog: [
    { id: 'catalog_500', maxRows: 500, price: 700_000 },
    { id: 'catalog_2000', maxRows: 2_000, price: 1_500_000 },
    { id: 'catalog_10000', maxRows: 10_000, price: 4_000_000 },
  ],
} as const;

/** What a plan card lists, in its order. */
export const FEATURES = ['risks', 'suggestions', 'team', 'activity', 'dictionary', 'export', 'reminders', 'api', 'branding', 'clientLinks'] as const;
export type Feature = (typeof FEATURES)[number];
export type PlanKey = 'trial' | Tier;

/**
 * Which plan has which feature: the cards on the landing page, the help article and the app read
 * this one table. The app refuses a missing GATED feature (planHas in plan.ts); `export` is the
 * corrected file, refused by BILLING_REQUIRED_FOR_EXPORT without a paid order or subscription.
 */
const ALL: Record<Feature, boolean> = Object.fromEntries(FEATURES.map((f) => [f, true])) as Record<Feature, boolean>;
export const PLAN_FEATURES: Record<PlanKey, Record<Feature, boolean>> = {
  trial: { ...ALL, export: false, reminders: false, branding: false, clientLinks: false },
  company: { ...ALL, branding: false, clientLinks: false },
  accountant: ALL,
  firm: ALL,
};

/** Features the app itself refuses when the plan lacks them; the rest are on in every plan. */
export const GATED_FEATURES = ['reminders', 'branding', 'clientLinks'] as const satisfies readonly Feature[];
export type GatedFeature = (typeof GATED_FEATURES)[number];

export type Plan = {
  id: string;
  price: number;
  kind: 'catalog' | 'subscription';
  maxRows: number | null;
  /** Subscriptions only: the tier and how many months one payment buys. */
  tier?: Tier;
  months?: number;
};

export function yearlyPrice(monthly: number): number {
  return monthly * YEARLY_PAID_MONTHS;
}

/** `firm_monthly` is also the id the single firm subscription had before the tiers, so its orders still resolve. */
export function subscriptionId(tier: Tier, period: Period): string {
  return `${tier}_${period}`;
}

export function subscriptionPlan(tier: Tier, period: Period): Plan {
  const monthly = PLANS.tiers[tier].monthly;
  return {
    id: subscriptionId(tier, period),
    price: period === 'monthly' ? monthly : yearlyPrice(monthly),
    kind: 'subscription',
    maxRows: null,
    tier,
    months: PERIOD_MONTHS[period],
  };
}

export const SUBSCRIPTION_IDS: string[] = TIERS.flatMap((tier) => PERIODS.map((period) => subscriptionId(tier, period)));

/** The "Toʻgʻrilangan katalog" tier for a catalogue; null above the largest (priced individually). */
export function catalogPlan(rows: number): Plan | null {
  const tier = PLANS.catalog.find((p) => rows <= p.maxRows);
  return tier ? { id: tier.id, price: tier.price, kind: 'catalog', maxRows: tier.maxRows } : null;
}

/** Any plan by id, including ids of orders recorded before the tiers. */
export function planById(id: string): Plan | null {
  const tier = PLANS.catalog.find((p) => p.id === id);
  if (tier) return { id: tier.id, price: tier.price, kind: 'catalog', maxRows: tier.maxRows };
  for (const t of TIERS) {
    for (const period of PERIODS) {
      if (subscriptionId(t, period) === id) return subscriptionPlan(t, period);
    }
  }
  return null;
}

/** The top tier's monthly price: what GET /api/config has always called the firm price. */
export function firmPrice(): number {
  return PLANS.tiers.firm.monthly;
}

export type TierOffer = { tier: Tier; limits: Limits; apiChecks: number | null; monthly: Plan; yearly: Plan };

/** Every tier with both of its plans, cheapest first: what the plan tab, help and API docs list. */
export function tierOffers(): TierOffer[] {
  return TIERS.map((tier) => ({
    tier,
    limits: { ...PLANS.tiers[tier].limits },
    apiChecks: PLANS.tiers[tier].apiChecks,
    monthly: subscriptionPlan(tier, 'monthly'),
    yearly: subscriptionPlan(tier, 'yearly'),
  }));
}
