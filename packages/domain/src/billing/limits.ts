// Plan limits per plan, read from PLANS (billing/plans.ts) — the same numbers the landing page
// promises. They used to come from PLAN_TRIAL_* / PLAN_FIRM_* env vars; those are no longer read,
// because a server-only override would make the app enforce something the landing does not say.
import { PLANS, TIERS, type Tier } from './plans';

export type Limits = { clients: number | null; rowsPerMonth: number | null; seats: number | null };
export type LimitKey = keyof Limits;

export const TRIAL_DAYS = PLANS.trial.days;

export type PlanLimits = { trial: Limits } & Record<Tier, Limits>;

/** The trial's limits and each tier's; `firm` is the top tier (the single firm plan of old). */
export function planLimits(): PlanLimits {
  const tiers = Object.fromEntries(TIERS.map((t) => [t, { ...PLANS.tiers[t].limits }])) as Record<Tier, Limits>;
  return { trial: { ...PLANS.trial.limits }, ...tiers };
}

/** Share of a limit at which the app starts warning. */
export const WARN_AT = 0.8;
