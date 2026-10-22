// What an org may do right now: trial or firm limits, usage against them,
// warnings at 80% and a paywall at 100% or when the trial has ended. The web app's
// src/lib/plan.ts memoises planStatus once per render and builds its gates on that copy.
import { db } from '@tasnivo/db';
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
 * Previews have their own cap instead (previewGate) and are swept after 48 hours.
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

/** Reads the plan and usage each call; the web app wraps it once per render (apps/web/src/lib/plan.ts). */
export async function planStatus(orgId: string, now = new Date()): Promise<PlanStatus> {
  const [org, usage] = await Promise.all([
    db.organization.findUnique({ where: { id: orgId }, select: { kind: true, trialEndsAt: true, subscriptionUntil: true } }),
    usageOf(orgId, now),
  ]);
  const limits = planLimits();
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

/** Cap on uncommitted preview rows when the plan sets no monthly row limit. */
export const PREVIEW_ROWS_UNCAPPED = 200_000;
const PREVIEW_WINDOW_MS = 24 * 3_600_000;

/** Preview rows an org may hold from the last 24 hours: the plan's monthly rows when capped. */
export function previewCap(limits: Pick<Limits, 'rowsPerMonth'>): number {
  return limits.rowsPerMonth ?? PREVIEW_ROWS_UNCAPPED;
}

export type PreviewGate = { ok: true } | { ok: false; cap: number };

/** The gates, over a given way of reading the plan status (the web app passes its once-per-render copy). */
export function planGates(statusOf: (orgId: string, now?: Date) => Promise<PlanStatus>) {
  /** Checks a resource for an org straight from the database. */
  async function gate(orgId: string, key: LimitKey, adding = 1): Promise<Gate> {
    return allows(await statusOf(orgId), key, adding);
  }

  /**
   * Whether `adding` more uncommitted rows still fit. Previews do not use the
   * monthly allowance, so without this cap uploading and never committing
   * would store rows without limit.
   */
  async function previewGate(orgId: string, adding: number, now = new Date()): Promise<PreviewGate> {
    const [status, open] = await Promise.all([
      statusOf(orgId, now),
      db.catalog.aggregate({
        where: { orgId, status: 'uploaded', createdAt: { gte: new Date(now.getTime() - PREVIEW_WINDOW_MS) } },
        _sum: { rowCount: true },
      }),
    ]);
    const cap = previewCap(status.limits);
    return (open._sum.rowCount ?? 0) + adding > cap ? { ok: false, cap } : { ok: true };
  }

  /**
   * Purchase lists and cheque or sales lists do not use the monthly row
   * allowance (they are not audited catalogues), but like every upload they are
   * refused once the trial or the subscription has ended.
   */
  async function uploadsOpen(orgId: string): Promise<Gate> {
    const status = await statusOf(orgId);
    return status.state === 'expired' ? { ok: false, reason: 'expired' } : { ok: true };
  }

  return { gate, previewGate, uploadsOpen };
}

export const { gate, previewGate, uploadsOpen } = planGates(planStatus);
