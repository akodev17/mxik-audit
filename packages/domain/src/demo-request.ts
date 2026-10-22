// The public demo's two steps as the visitor sees them: ask for a link (POST /api/demo/request,
// actions/demo.ts requestDemo) and use it (POST /api/demo/open, openDemo), with the messages in
// the visitor's language. The caller writes the session cookie for an opened demo.
import { db } from '@tasnivo/db';
import { dict, type Locale } from '@tasnivo/i18n/i18n';
import { claimDemoAccess, DEMO_LIMITS, peekDemoLink, requestDemoAccess, type RequestFailure } from './demo-access';
import { demoIdleMinutes, demoLinkMinutes, demoTtlHours } from './demo-config';
import type { DemoSession } from './demo';
import { HONEYPOT_FIELD } from './lead-guard';
import { hit, RULES } from './security/rate-limit';
import { createRecord, endRecord } from './security/session-store';
import { clearPending, type SignInSession } from './security/sign-in';

export type DemoState = { error?: string; sentTo?: string; field?: 'email' };

/** What the form sent; anything that is not a string counts as empty. */
export type DemoFields = Partial<Record<'name' | 'company' | 'email' | 'useCase' | typeof HONEYPOT_FIELD, unknown>>;

/** A field as the form handler read it: one character past the limit, so an overlong value is still refused. */
const cut = (value: unknown, max: number): string => (typeof value === 'string' ? value.slice(0, max + 1) : '');

/**
 * Asks for demo access. The visitor is e-mailed a single-use link; nothing opens until it is used.
 * Throwaway e-mail providers, repeated requests and more than a few demos a day per mailbox are refused.
 */
export async function requestDemo(fields: DemoFields, ctx: { ip: string; locale: Locale }): Promise<DemoState> {
  const t = dict(ctx.locale);
  const d = t.demoAccess;
  // A field real visitors never see: a bot that fills it is told it worked, and nothing is sent.
  if (cut(fields[HONEYPOT_FIELD], 100)) return { sentTo: cut(fields.email, DEMO_LIMITS.email) };

  const email = cut(fields.email, DEMO_LIMITS.email);
  const result = await requestDemoAccess(
    { name: cut(fields.name, DEMO_LIMITS.name), company: cut(fields.company, DEMO_LIMITS.company), email, useCase: cut(fields.useCase, 30) },
    { ip: ctx.ip, mail: { subject: d.mail.subject, body: d.mail.body } },
  );
  if (result.ok) return { sentTo: email.trim().toLowerCase() };
  const errors: Record<RequestFailure, string> = {
    invalid: d.errors.invalid, email: d.errors.email, disposable: d.errors.disposable,
    rate: d.errors.rate, limit: d.errors.limit, unavailable: t.demoUnavailable,
  };
  return { error: errors[result.error], field: result.error === 'email' || result.error === 'disposable' ? 'email' : undefined };
}

/** Link tokens are 43 characters; anything far off is not looked up. */
const plausibleToken = (token: unknown): token is string => typeof token === 'string' && token.length >= 20 && token.length <= 100;

export type OpenedDemo = { ok: true; session: DemoSession; landing: string } | { ok: false; state: DemoState };

/**
 * Uses a demo link up and opens a fresh demo org for its owner. The caller then replaces whoever
 * was signed in with `session` and sends the browser to `landing`: the sample catalogue.
 */
export async function openDemoLink(token: unknown, ctx: { ip: string; locale: Locale }): Promise<OpenedDemo> {
  const t = dict(ctx.locale);
  if (!plausibleToken(token)) return { ok: false, state: { error: t.demoAccess.errors.link } };
  if (!(await hit(RULES.demoVerifyIp, ctx.ip)).allowed) return { ok: false, state: { error: t.demoAccess.errors.rate } };
  const claim = await claimDemoAccess(token);
  if (!claim.ok) {
    return { ok: false, state: { error: claim.error === 'invalid' ? t.demoAccess.errors.link : claim.error === 'limit' ? t.demoAccess.errors.limit : t.demoUnavailable } };
  }
  // Straight into the sample catalogue, on its risky rows.
  const sample = await db.catalog.findFirst({ where: { orgId: claim.session.orgId }, orderBy: { createdAt: 'desc' }, select: { id: true } });
  return { ok: true, session: claim.session, landing: sample ? `/catalogs/${sample.id}` : '/catalogs' };
}

/** Whose link this is, before it is used (demo/verify/[token]); null for a used, expired or implausible one. */
export async function peekDemo(token: string): Promise<{ name: string } | null> {
  return plausibleToken(token) ? peekDemoLink(token) : null;
}

/** How long a link and a demo session last, for the demo pages. */
export function demoTimes(): { linkMinutes: number; idleMinutes: number; ttlHours: number } {
  return { linkMinutes: demoLinkMinutes(), idleMinutes: demoIdleMinutes(), ttlHours: demoTtlHours() };
}

/**
 * Signs this browser in to the opened demo. A demo replaces whoever was signed in here: their
 * session record ends and nothing of it stays in the cookie.
 */
export async function enterDemo(session: SignInSession, demo: DemoSession, userAgent: string | null): Promise<void> {
  if (session.sid) await endRecord(session.sid);
  clearPending(session);
  session.sid = await createRecord(demo.userId, demo.orgId, userAgent);
  session.userId = demo.userId;
  session.orgId = demo.orgId;
  session.email = demo.email;
  session.demo = true;
  session.clientId = undefined;
  await session.save();
}
