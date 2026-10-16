// Plan limits, in one config object. The numbers are the owner's to set:
// override them with PLAN_TRIAL_* / PLAN_FIRM_* env vars (a number, or
// "unlimited"). The defaults below are placeholders, not a commercial decision.
export type Limits = { clients: number | null; rowsPerMonth: number | null; seats: number | null };
export type LimitKey = keyof Limits;

export const TRIAL_DAYS = 14;

type Env = Record<string, string | undefined>;

function limit(raw: string | undefined, fallback: number | null): number | null {
  const value = raw?.trim().toLowerCase();
  if (!value) return fallback;
  if (value === 'unlimited') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

export function planLimits(env: Env = process.env): { trial: Limits; firm: Limits } {
  return {
    trial: {
      clients: limit(env['PLAN_TRIAL_CLIENTS'], 3),
      rowsPerMonth: limit(env['PLAN_TRIAL_ROWS'], 5_000),
      seats: limit(env['PLAN_TRIAL_SEATS'], 2),
    },
    firm: {
      clients: limit(env['PLAN_FIRM_CLIENTS'], null),
      rowsPerMonth: limit(env['PLAN_FIRM_ROWS'], null),
      seats: limit(env['PLAN_FIRM_SEATS'], null),
    },
  };
}

/** Share of a limit at which the app starts warning. */
export const WARN_AT = 0.8;
