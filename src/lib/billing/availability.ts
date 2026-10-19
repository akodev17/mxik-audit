// Whether something can be bought on this server right now, and if not, exactly why.
// Never a pretend checkout: without a price or a payment provider there is nothing to press.
import type { BillingConfig } from './config';
import type { Plan } from './plans';

export type Provider = 'click' | 'payme';

export function providersOf(config: BillingConfig): Provider[] {
  return [config.click ? 'click' as const : null, config.payme ? 'payme' as const : null].filter((p): p is Provider => p !== null);
}

export type Purchase =
  | { kind: 'available'; price: number; providers: Provider[] }
  /** The price is not set: not for sale yet. */
  | { kind: 'not_for_sale' }
  /** Priced, but no payment provider is configured on this server. */
  | { kind: 'no_provider'; price: number }
  /** Priced and payable, but only an admin pays. */
  | { kind: 'admin_only'; price: number }
  | { kind: 'demo' };

type Input = { plan: Plan | null; config: BillingConfig; admin: boolean; demo: boolean };

/** A plan (the firm subscription, or a catalogue tier) for this viewer. */
export function purchaseOf({ plan, config, admin, demo }: Input): Purchase {
  if (demo) return { kind: 'demo' };
  if (!plan) return { kind: 'not_for_sale' };
  const providers = providersOf(config);
  if (providers.length === 0) return { kind: 'no_provider', price: plan.price };
  if (!admin) return { kind: 'admin_only', price: plan.price };
  return { kind: 'available', price: plan.price, providers };
}

export type CatalogPurchase = Purchase | { kind: 'paid' } | { kind: 'too_large' };

/** The "Toʻgʻrilangan katalog" payment for one catalogue. `plan` is its tier (null above the largest). */
export function catalogPurchase(input: Input & { paid: boolean }): CatalogPurchase {
  if (input.paid) return { kind: 'paid' };
  if (!input.plan) return { kind: 'too_large' };
  return purchaseOf(input);
}
