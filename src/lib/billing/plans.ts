// Prices in soʻm, in one place for payments. The catalogue prices are the
// ones the landing page shows as text (PRICING in src/components/landing/
// config.ts); keep the two in step. The firm plan price is the owner's to set
// in PLAN_FIRM_PRICE: while it is unset the plan is not for sale anywhere.
export const PLANS = {
  catalog: [
    { id: 'catalog_500', maxRows: 500, price: 700_000 },
    { id: 'catalog_2000', maxRows: 2_000, price: 1_500_000 },
    { id: 'catalog_10000', maxRows: 10_000, price: 4_000_000 },
  ],
  firmMonthly: { id: 'firm_monthly', months: 1 },
};

export type Plan = { id: string; price: number; kind: 'catalog' | 'subscription'; maxRows: number | null };

type Env = Record<string, string | undefined>;

/** PLAN_FIRM_PRICE in whole soʻm ("990000" or "990 000"); null when unset or not a positive whole number. */
export function firmPrice(env: Env = process.env): number | null {
  const raw = env['PLAN_FIRM_PRICE']?.replace(/[\s_]/g, '');
  if (!raw || !/^\d+$/.test(raw)) return null;
  const price = Number(raw);
  return Number.isSafeInteger(price) && price > 0 ? price : null;
}

/** The "Toʻgʻrilangan katalog" tier for a catalogue; null above the largest (priced individually). */
export function catalogPlan(rows: number): Plan | null {
  const tier = PLANS.catalog.find((p) => rows <= p.maxRows);
  return tier ? { id: tier.id, price: tier.price, kind: 'catalog', maxRows: tier.maxRows } : null;
}

/** The firm subscription, or null while its price is not set. */
export function firmPlan(env: Env = process.env): Plan | null {
  const price = firmPrice(env);
  return price === null ? null : { id: PLANS.firmMonthly.id, price, kind: 'subscription', maxRows: null };
}

export function planById(id: string, env: Env = process.env): Plan | null {
  const tier = PLANS.catalog.find((p) => p.id === id);
  if (tier) return { id: tier.id, price: tier.price, kind: 'catalog', maxRows: tier.maxRows };
  const firm = firmPlan(env);
  return firm?.id === id ? firm : null;
}
