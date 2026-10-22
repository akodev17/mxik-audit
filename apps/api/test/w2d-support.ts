// Fixtures for the clients, billing, demo, admin, cron, telegram and public-api e2e tests: session
// cookies for any member, extra members with a role, and a reader for the cookie a response set.
// Import ./setup-env before this file.
import { randomBytes } from 'node:crypto';
import type { UserRole } from '@prisma/client';
import { sealData, unsealData } from 'iron-session';
import type { z } from 'zod';
import { db } from '@tasnivo/db';
import { createRecord } from '@tasnivo/domain/security/session-store';
import { sessionOptions, type SessionData } from '@tasnivo/domain/session';
import { SESSION_COOKIE } from '../src/auth-core/session.service';
import { cookiePair, setCookies } from './helpers';

export const CSRF = { 'X-Requested-With': 'tasnivo' } as const;

export type Member = { orgId: string; userId: string; email: string };

/** A "Cookie" header value signing `who` in, with a live session record, as the web app's sign-in would. */
export async function sessionCookie(who: Member, extra: Partial<SessionData> = {}): Promise<string> {
  const sid = await createRecord(who.userId, who.orgId, 'api-e2e');
  const seal = await sealData({ userId: who.userId, orgId: who.orgId, email: who.email, sid, ...extra } satisfies SessionData, { password: sessionOptions.password });
  return `${SESSION_COOKIE}=${seal}`;
}

/** Another member of an org; `clientIds` assigns them to those clients only. */
export async function addMember(orgId: string, role: UserRole, clientIds: string[] = []): Promise<Member> {
  const tag = randomBytes(5).toString('hex');
  const user = await db.user.create({ data: { orgId, email: `member-${tag}@test.local`, passwordHash: 'x', role, emailVerifiedAt: new Date() } });
  for (const clientId of clientIds) await db.clientAssignment.create({ data: { userId: user.id, clientId } });
  return { orgId, userId: user.id, email: user.email };
}

export async function addClient(orgId: string, name = `client-${randomBytes(4).toString('hex')}`, extra: { archivedAt?: Date; isDefault?: boolean } = {}) {
  return db.client.create({ data: { orgId, name, ...extra } });
}

/** The session fields of the cookie a response set, or null when it set none. */
export async function sessionSet(res: { headers: Record<string, unknown> }): Promise<SessionData | null> {
  const pair = cookiePair(setCookies(res), SESSION_COOKIE);
  if (!pair) return null;
  return unsealData<SessionData>(decodeURIComponent(pair.slice(SESSION_COOKIE.length + 1)), { password: sessionOptions.password });
}

/** Parses a response body with the endpoint's zod schema; throws with the issues when it does not fit. */
export function fits<S extends z.ZodTypeAny>(schema: S, body: unknown): z.infer<S> {
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new Error(`answer does not fit the contract: ${JSON.stringify(parsed.error.issues.slice(0, 5))}\n${JSON.stringify(body).slice(0, 500)}`);
  return parsed.data as z.infer<S>;
}

/** Sets environment variables for the duration of `run`, restoring them afterwards. */
export async function withEnv<T>(vars: Record<string, string | undefined>, run: () => Promise<T>): Promise<T> {
  const before = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return await run();
  } finally {
    for (const [k, v] of Object.entries(before)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}
