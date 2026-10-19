// Per-key rate limit and the monthly check allowance of the org plan.
// The numbers are config: API_RATE_PER_MINUTE and API_CHECKS_PER_MONTH_TRIAL / _FIRM.
import { db } from '../db';
import { planStatus } from '../plan';
import { monthKey } from './keys';

type Env = Record<string, string | undefined>;

function whole(raw: string | undefined, fallback: number | null): number | null {
  const value = raw?.trim().toLowerCase();
  if (!value) return fallback;
  if (value === 'unlimited') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

export function apiConfig(env: Env = process.env) {
  return {
    ratePerMinute: whole(env['API_RATE_PER_MINUTE'], 60) ?? 60,
    checksPerMonth: { trial: whole(env['API_CHECKS_PER_MONTH_TRIAL'], 500), firm: whole(env['API_CHECKS_PER_MONTH_FIRM'], null) },
    maxCheckItems: whole(env['API_CHECK_MAX_ITEMS'], 20) ?? 20,
  };
}

const WINDOW_MS = 60_000;
// In memory, per process: a restart or a second instance resets the window.
const hits = new Map<string, number[]>();

export type RateResult = { ok: boolean; limit: number; remaining: number; retryAfter: number };

export function takeRate(keyId: string, now = Date.now(), limit = apiConfig().ratePerMinute): RateResult {
  const recent = (hits.get(keyId) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= limit) {
    hits.set(keyId, recent);
    return { ok: false, limit, remaining: 0, retryAfter: Math.max(1, Math.ceil((WINDOW_MS - (now - (recent[0] ?? now))) / 1000)) };
  }
  recent.push(now);
  hits.set(keyId, recent);
  return { ok: true, limit, remaining: limit - recent.length, retryAfter: 0 };
}

export type Allowance = { ok: true } | { ok: false; reason: 'expired' | 'checks' };

/** Whether `adding` more checks fit this month; an expired trial allows none. */
export async function checkAllowance(orgId: string, adding: number): Promise<Allowance> {
  const status = await planStatus(orgId);
  if (status.state === 'expired') return { ok: false, reason: 'expired' };
  const config = apiConfig().checksPerMonth;
  const cap = status.state === 'trial' ? config.trial : status.state === 'firm' ? config.firm : null;
  if (cap === null) return { ok: true };
  const used = await db.apiUsage.aggregate({ where: { orgId, month: monthKey() }, _sum: { checks: true } });
  return (used._sum.checks ?? 0) + adding > cap ? { ok: false, reason: 'checks' } : { ok: true };
}

export async function recordUsage(keyId: string, orgId: string, checks: number): Promise<void> {
  const month = monthKey();
  await db.apiUsage.upsert({
    where: { keyId_month: { keyId, month } },
    create: { keyId, orgId, month, checks, requests: 1 },
    update: { checks: { increment: checks }, requests: { increment: 1 } },
  });
}
