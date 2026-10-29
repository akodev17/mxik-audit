// Subscription periods (pure): calendar months with the day clamped, and the tier rule (plan D2).
// While a subscription is active a payment may renew the same tier (extends from the current end)
// or upgrade to a dearer one (starts now; the unused days become days of the new tier at the price
// ratio). A cheaper tier waits until the subscription has ended, unless an operator forces it.
import { PLANS, type Plan, type Tier } from './plans';

const DAY = 86_400_000;

/** `from` plus whole calendar months; a day the target month lacks becomes its last (31 Jan + 1 = 28/29 Feb). */
export function addMonths(from: Date, months: number): Date {
  const day = from.getUTCDate();
  const out = new Date(from);
  out.setUTCDate(1);
  out.setUTCMonth(out.getUTCMonth() + months);
  const last = new Date(Date.UTC(out.getUTCFullYear(), out.getUTCMonth() + 1, 0)).getUTCDate();
  out.setUTCDate(Math.min(day, last));
  return out;
}

/** The subscription in force: its tier and end. */
export type ActiveSubscription = { tier: Tier; until: Date };

export type NextPeriod =
  | { ok: true; kind: 'new' | 'renew' | 'upgrade' | 'forced'; until: Date; creditDays: number }
  | { ok: false; reason: 'plan_change' };

/** Unused days of `from` turned into days of `to` at the monthly price ratio, floored. */
export function creditDays(remainingMs: number, from: Tier, to: Tier): number {
  return Math.floor((Math.max(0, remainingMs) / DAY) * PLANS.tiers[from].monthly / PLANS.tiers[to].monthly);
}

/**
 * The end a subscription payment of `plan` gives. No active subscription (or a trial): it starts
 * now and the trial's remaining days are not added. `force` (an operator's bank transfer) treats a
 * cheaper or equal-price tier like an upgrade instead of refusing it.
 */
export function nextPeriod(active: ActiveSubscription | null, plan: Plan, now: Date, force = false): NextPeriod {
  const months = plan.months ?? 1;
  const tier = plan.tier ?? 'firm';
  if (!active || active.until <= now) return { ok: true, kind: 'new', until: addMonths(now, months), creditDays: 0 };
  if (active.tier === tier) return { ok: true, kind: 'renew', until: addMonths(active.until, months), creditDays: 0 };
  const upgrade = PLANS.tiers[tier].monthly > PLANS.tiers[active.tier].monthly;
  if (!upgrade && !force) return { ok: false, reason: 'plan_change' };
  const credit = creditDays(active.until.getTime() - now.getTime(), active.tier, tier);
  return { ok: true, kind: upgrade ? 'upgrade' : 'forced', until: new Date(addMonths(now, months).getTime() + credit * DAY), creditDays: credit };
}
