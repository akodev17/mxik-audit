// Prices in soʻm, in one place for payments. The catalogue prices are the
// ones the landing page shows as text (PRICING in src/components/landing/
// config.ts); keep the two in step. The firm plan price is the owner's to
// fill: while it is null the plan is hidden everywhere.
export const PLANS = {
  catalog: [
    { id: 'catalog_500', maxRows: 500, price: 700_000 },
    { id: 'catalog_2000', maxRows: 2_000, price: 1_500_000 },
    { id: 'catalog_10000', maxRows: 10_000, price: 4_000_000 },
  ],
  firmMonthly: { id: 'firm_monthly', price: null as number | null, months: 1 },
};

export type Plan = { id: string; price: number; kind: 'catalog' | 'subscription'; maxRows: number | null };

/** The "Toʻgʻrilangan katalog" tier for a catalogue; null above the largest (priced individually). */
export function catalogPlan(rows: number): Plan | null {
  const tier = PLANS.catalog.find((p) => rows <= p.maxRows);
  return tier ? { id: tier.id, price: tier.price, kind: 'catalog', maxRows: tier.maxRows } : null;
}

/** The firm subscription, or null while its price is not set. */
export function firmPlan(): Plan | null {
  const { id, price } = PLANS.firmMonthly;
  return price !== null && price > 0 ? { id, price, kind: 'subscription', maxRows: null } : null;
}

export function planById(id: string): Plan | null {
  const tier = PLANS.catalog.find((p) => p.id === id);
  if (tier) return { id: tier.id, price: tier.price, kind: 'catalog', maxRows: tier.maxRows };
  const firm = firmPlan();
  return firm?.id === id ? firm : null;
}
