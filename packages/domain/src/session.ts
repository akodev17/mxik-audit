// The session cookie's contents and the access behind it, without a framework. The web app's
// src/lib/session.ts reads the cookie through Next and memoises these reads once per render.
import type { SessionOptions } from 'iron-session';
import { db } from '@tasnivo/db';
import { SESSION_MAX_AGE_SECONDS } from './security/session-store';

export type SessionData = {
  userId?: string;
  orgId?: string;
  email?: string;
  /** Display only. Anything that matters re-checks the org's kind in the database. */
  demo?: boolean;
  /** The client being worked on. Always re-checked against the org before use. */
  clientId?: string;
  /** The server-side session record (security/session-store.ts). Required for every org except a demo. */
  sid?: string;
  /** Password accepted, two-factor code still to enter. */
  pendingUserId?: string;
  pendingVia?: string;
  pendingLanding?: string;
  pendingAt?: number;
  /** One-time state for binding Telegram from Settings, and when it was issued. */
  tgBind?: string;
  tgBindAt?: number;
};

const PASSWORD = process.env['SESSION_SECRET'] ?? '';

export const sessionOptions: SessionOptions = {
  password: PASSWORD,
  cookieName: 'mxik_audit_session',
  cookieOptions: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_MAX_AGE_SECONDS,
  },
};

/** Throws early with a clear message rather than failing obscurely at runtime. */
export function assertSecret(): void {
  if (PASSWORD.length < 32) {
    throw new Error(
      'SESSION_SECRET must be set to at least 32 characters. See .env.example.',
    );
  }
}

export type Role = 'admin' | 'accountant' | 'viewer';

export type CurrentUser = {
  userId: string; orgId: string; email: string; demo: boolean; clientId: string | null;
  role: Role;
  /** Clients this user may open; null = every client of the org. */
  clientIds: string[] | null;
};

export type Access = { role: Role; clientIds: string[] | null; demoOrg: boolean };

/** Role and client scope come from the database, so a change applies at once. */
export async function loadAccess(userId: string, orgId: string): Promise<Access | null> {
  const user = await db.user.findFirst({
    where: { id: userId, orgId, org: { deletedAt: null } },
    select: { role: true, assignments: { select: { clientId: true } }, org: { select: { kind: true, expiresAt: true } } },
  });
  if (!user) return null;
  // A demo is over at its fixed end, whatever the cookie says; the purge job only tidies up afterwards.
  if (user.org.kind === 'demo' && (!user.org.expiresAt || user.org.expiresAt <= new Date())) return null;
  const assigned = user.assignments.map((a) => a.clientId);
  return { role: user.role, clientIds: user.role === 'admin' || assigned.length === 0 ? null : assigned, demoOrg: user.org.kind === 'demo' };
}
