// The colour of a usage meter in the plan tab and on the dashboard. Pure; tests/web-parity holds
// WARN_AT to the domain's.

/** Same value as WARN_AT in the domain's billing/limits.ts: a meter turns amber at 80 % of the cap. */
export const WARN_AT = 0.8;

export function meterTone(used: number, cap: number): 'brand' | 'warn' | 'danger' {
  if (used >= cap) return 'danger';
  return used >= cap * WARN_AT ? 'warn' : 'brand';
}
