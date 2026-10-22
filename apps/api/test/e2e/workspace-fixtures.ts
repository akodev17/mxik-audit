// Fixtures for the workspace, dictionary, reminders and notifications e2e tests: people of every
// role with a live session cookie (a real session record, sealed like the web app's), on orgs made
// by @tasnivo/domain/test-fixtures so dropOrgs removes everything. Import ../setup-env first.
import type { UserRole } from '@prisma/client';
import { sealData } from 'iron-session';
import type { Test } from 'supertest';
import { CSRF_HEADER, CSRF_VALUE, type Endpoint } from '@tasnivo/contracts';
import { makePerson } from '@tasnivo/domain/firm-test-fixtures';
import { createRecord } from '@tasnivo/domain/security/session-store';
import { sessionOptions, type SessionData } from '@tasnivo/domain/session';
import { makeOrg } from '@tasnivo/domain/test-fixtures';
import { SESSION_COOKIE } from '../../src/auth-core/session.service';

export type Member = { userId: string; orgId: string; email: string; role: UserRole; cookie: string };

/** A session cookie for an existing user, as the web app's sign-in would set it. */
export async function cookieFor(user: { userId: string; orgId: string; email: string }, opts: { demo?: boolean; clientId?: string } = {}): Promise<string> {
  const sid = await createRecord(user.userId, user.orgId, 'api-e2e');
  const data: SessionData = { userId: user.userId, orgId: user.orgId, email: user.email, demo: opts.demo === true, sid, ...(opts.clientId ? { clientId: opts.clientId } : {}) };
  return `${SESSION_COOKIE}=${await sealData(data, { password: sessionOptions.password })}`;
}

/** A member of the org with this role (clientIds = assignments), signed in. */
export async function member(orgId: string, role: UserRole, clientIds: string[] = [], opts: { demo?: boolean } = {}): Promise<Member> {
  const p = await makePerson(orgId, role, clientIds);
  return { userId: p.userId, orgId, email: p.email, role, cookie: await cookieFor(p, opts) };
}

/** A fresh org (customer or demo) and its admin, signed in; the org id goes on `orgs` for dropOrgs. */
export async function orgWithAdmin(orgs: string[], kind: 'customer' | 'demo' = 'customer'): Promise<Member> {
  const org = await makeOrg(kind, kind === 'demo' ? new Date(Date.now() + 86_400_000) : undefined);
  orgs.push(org.orgId);
  return member(org.orgId, 'admin', [], { demo: kind === 'demo' });
}

/** A JSON body as the contract's response schema reads it; throws (fails the test) when the shape drifts. */
export function shaped<E extends Endpoint>(endpoint: E, body: unknown): unknown {
  if (endpoint.responds !== 'json') throw new Error(`${endpoint.operationId} does not answer JSON`);
  return endpoint.response.parse(body);
}

/** Sets the cookie and, on a mutating endpoint, the CSRF header the browser client sends. */
export function as(req: Test, who: Pick<Member, 'cookie'>, csrf = true): Test {
  req.set('Cookie', who.cookie);
  return csrf ? req.set(CSRF_HEADER, CSRF_VALUE) : req;
}
