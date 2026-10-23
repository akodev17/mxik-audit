// Per-key rate limit and the monthly check allowance of the org plan.
// The rate and batch size are config (API_RATE_PER_MINUTE, API_CHECK_MAX_ITEMS); the monthly
// allowance is each plan's, from PLANS (billing/plans.ts), like every other plan limit.
import { db } from '@tasnivo/db';
import { PLANS, TIERS, type Tier } from '../billing/plans';
import { planStatus, type PlanStatus } from '../plan';
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
    checksPerMonth: checksPerMonth(),
    maxCheckItems: whole(env['API_CHECK_MAX_ITEMS'], 20) ?? 20,
  };
}

/** Checks a month per plan; `firm` is the top tier (the single firm plan of old). */
function checksPerMonth(): { trial: number | null } & Record<Tier, number | null> {
  const tiers = Object.fromEntries(TIERS.map((t) => [t, PLANS.tiers[t].apiChecks])) as Record<Tier, number | null>;
  return { trial: PLANS.trial.apiChecks, ...tiers };
}

export type ApiConfig = ReturnType<typeof apiConfig>;

/** Checks a month allowed for a plan status; null = no cap. An expired trial allows none. */
export function monthlyCheckCap(status: Pick<PlanStatus, 'state' | 'tier'>, config: ApiConfig = apiConfig()): number | null {
  if (status.state === 'expired') return 0;
  if (status.state === 'trial') return config.checksPerMonth.trial;
  if (status.state === 'firm') return config.checksPerMonth[status.tier ?? 'firm'];
  return null;
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

/**
 * Reserves `adding` checks of this month's allowance for the key before they run (Q6): under a
 * transaction-scoped advisory lock per org, the month's total is read and, when the checks fit, the
 * key's row is incremented in the same transaction, so parallel requests cannot all pass the same
 * total. An expired trial allows none. Give the checks back with releaseChecks when the run fails.
 */
export async function reserveChecks(keyId: string, orgId: string, adding: number): Promise<Allowance> {
  const status = await planStatus(orgId);
  if (status.state === 'expired') return { ok: false, reason: 'expired' };
  const cap = monthlyCheckCap(status);
  const month = monthKey();
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('api_checks'), hashtext(${orgId}))`;
    if (cap !== null) {
      const used = await tx.apiUsage.aggregate({ where: { orgId, month }, _sum: { checks: true } });
      if ((used._sum.checks ?? 0) + adding > cap) return { ok: false, reason: 'checks' } as const;
    }
    await tx.apiUsage.upsert({
      where: { keyId_month: { keyId, month } },
      create: { keyId, orgId, month, checks: adding, requests: 0 },
      update: { checks: { increment: adding } },
    });
    return { ok: true } as const;
  });
}

/** Gives back checks reserveChecks took for a run that failed. */
export async function releaseChecks(keyId: string, checks: number): Promise<void> {
  await db.apiUsage.updateMany({ where: { keyId, month: monthKey(), checks: { gte: checks } }, data: { checks: { decrement: checks } } });
}

/** The org's API use this calendar month (UTC), over all its keys. */
export async function usageThisMonth(orgId: string): Promise<{ checks: number; requests: number }> {
  const used = await db.apiUsage.aggregate({ where: { orgId, month: monthKey() }, _sum: { checks: true, requests: true } });
  return { checks: used._sum.checks ?? 0, requests: used._sum.requests ?? 0 };
}

export async function recordUsage(keyId: string, orgId: string, checks: number): Promise<void> {
  const month = monthKey();
  await db.apiUsage.upsert({
    where: { keyId_month: { keyId, month } },
    create: { keyId, orgId, month, checks, requests: 1 },
    update: { checks: { increment: checks }, requests: { increment: 1 } },
  });
}

/** Checks a process runs at once (API_CHECK_CONCURRENCY, default 4, at least 1). */
export function checkConcurrency(env: Env = process.env): number {
  return Math.max(1, whole(env['API_CHECK_CONCURRENCY'], 4) ?? 4);
}

// In memory, per process: matching holds the embedding model and the classifier pool, so a burst of
// checks waits for a slot at the client (429 + Retry-After) instead of multiplying the work (Q1).
let checksRunning = 0;

/** Seconds a refused check is told to wait before retrying. */
export const CHECK_BUSY_RETRY_SECONDS = 2;

/** Takes a check slot: the release function, or null when `limit` checks are already running. */
export function startCheck(limit = checkConcurrency()): (() => void) | null {
  if (checksRunning >= limit) return null;
  checksRunning += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    checksRunning -= 1;
  };
}

/** Checks running in this process now. */
export function checksInFlight(): number {
  return checksRunning;
}
