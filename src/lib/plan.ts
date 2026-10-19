// What an org may do right now: trial or firm limits, usage against them,
// warnings at 80% and a paywall at 100% or when the trial has ended.
import { db } from './db';
import { planLimits, WARN_AT, type LimitKey, type Limits } from './billing/limits';

export type PlanState = 'unlimited' | 'trial' | 'firm' | 'expired';

export type Usage = { clients: number; rowsPerMonth: number; seats: number };

export type PlanStatus = {
  state: PlanState;
  trialEndsAt: Date | null;
  daysLeft: number | null;
  limits: Limits;
  usage: Usage;
  /** Limits at 80% or more of their cap. */
  warnings: LimitKey[];
  /** Limits already full; adding more is refused. */
  full: LimitKey[];
};

const KEYS: LimitKey[] = ['clients', 'rowsPerMonth', 'seats'];
const monthStart = (now: Date): Date => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

/**
 * Rows count once a catalogue is committed (its mapping confirmed): a preview
 * left at "uploaded", then abandoned or discarded, never uses the allowance.
 */
export async function usageOf(orgId: string, now = new Date()): Promise<Usage> {
  const [clients, rows, users, invites] = await Promise.all([
    db.client.count({ where: { orgId } }),
    db.catalog.aggregate({ where: { orgId, createdAt: { gte: monthStart(now) }, status: { not: 'uploaded' } }, _sum: { rowCount: true } }),
    db.user.count({ where: { orgId } }),
    db.invite.count({ where: { orgId, usedAt: null, expiresAt: { gt: now } } }),
  ]);
  return { clients, rowsPerMonth: rows._sum.rowCount ?? 0, seats: users + invites };
}

export async function planStatus(orgId: string, now = new Date()): Promise<PlanStatus> {
  const org = await db.organization.findUnique({ where: { id: orgId }, select: { kind: true, trialEndsAt: true, subscriptionUntil: true } });
  const limits = planLimits();
  const usage = await usageOf(orgId, now);
  const none: Limits = { clients: null, rowsPerMonth: null, seats: null };

  let state: PlanState;
  if (!org || org.kind !== 'customer') state = 'unlimited';
  else if (org.subscriptionUntil && org.subscriptionUntil > now) state = 'firm';
  else if (org.trialEndsAt && org.trialEndsAt > now) state = 'trial';
  else state = 'expired';

  const active = state === 'unlimited' ? none : state === 'firm' ? limits.firm : limits.trial;
  const daysLeft = state === 'trial' && org?.trialEndsAt ? Math.max(0, Math.ceil((org.trialEndsAt.getTime() - now.getTime()) / 86_400_000)) : null;
  const capped = KEYS.filter((k) => active[k] !== null);
  return {
    state,
    trialEndsAt: org?.trialEndsAt ?? null,
    daysLeft,
    limits: active,
    usage,
    warnings: capped.filter((k) => usage[k] >= (active[k] ?? Infinity) * WARN_AT),
    full: state === 'expired' ? KEYS : capped.filter((k) => usage[k] >= (active[k] ?? Infinity)),
  };
}

export type Gate = { ok: true } | { ok: false; reason: 'expired' | LimitKey };

/** Whether `adding` more of a resource still fits. Reading is never blocked. */
export function allows(status: PlanStatus, key: LimitKey, adding = 1): Gate {
  if (status.state === 'expired') return { ok: false, reason: 'expired' };
  const cap = status.limits[key];
  if (cap === null) return { ok: true };
  return status.usage[key] + adding > cap ? { ok: false, reason: key } : { ok: true };
}

/** Checks a resource for an org straight from the database. */
export async function gate(orgId: string, key: LimitKey, adding = 1): Promise<Gate> {
  return allows(await planStatus(orgId), key, adding);
}

/**
 * Purchase lists and cheque or sales lists do not use the monthly row
 * allowance (they are not audited catalogues), but like every upload they are
 * refused once the trial or the subscription has ended.
 */
export async function uploadsOpen(orgId: string): Promise<Gate> {
  const status = await planStatus(orgId);
  return status.state === 'expired' ? { ok: false, reason: 'expired' } : { ok: true };
}

export const GATE_MESSAGE: Record<'expired' | LimitKey, string> = {
  expired: 'Sinov muddati tugadi. Davom etish uchun Sozlamalar sahifasida tarifni faollashtiring.',
  clients: 'Tarifdagi mijozlar soni chegarasiga yetdingiz. Tarifni yangilang.',
  rowsPerMonth: 'Bu oy uchun qatorlar chegarasi tugadi. Tarifni yangilang.',
  seats: 'Tarifdagi foydalanuvchilar soni chegarasiga yetdingiz. Tarifni yangilang.',
};
