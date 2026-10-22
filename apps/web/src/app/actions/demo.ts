'use server';

import { getI18n } from '@/lib/locale';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { db } from '@tasnivo/db';
import { claimDemoAccess, DEMO_LIMITS, requestDemoAccess, type RequestFailure } from '@tasnivo/domain/demo-access';
import { clientIp } from '@tasnivo/domain/security/client-ip';
import { hit, RULES } from '@tasnivo/domain/security/rate-limit';
import { createRecord, endRecord } from '@tasnivo/domain/security/session-store';
import { clearPending } from '@/lib/security/sign-in';
import { getSession } from '@/lib/session';

export type DemoState = { error?: string; sentTo?: string; field?: 'email' };

const field = (form: FormData, name: string, max: number): string => {
  const v = form.get(name);
  return typeof v === 'string' ? v.slice(0, max + 1) : '';
};

/**
 * Asks for demo access. The visitor is e-mailed a single-use link; nothing opens until it is used.
 * Throwaway e-mail providers, repeated requests and more than a few demos a day per mailbox are refused.
 */
export async function requestDemo(_prev: DemoState, form: FormData): Promise<DemoState> {
  const { t } = await getI18n();
  const d = t.demoAccess;
  // A field real visitors never see: a bot that fills it is told it worked, and nothing is sent.
  if (field(form, 'website', 100)) return { sentTo: field(form, 'email', DEMO_LIMITS.email) };

  const mail = { subject: d.mail.subject, body: d.mail.body };
  const email = field(form, 'email', DEMO_LIMITS.email);
  const result = await requestDemoAccess(
    { name: field(form, 'name', DEMO_LIMITS.name), company: field(form, 'company', DEMO_LIMITS.company), email, useCase: field(form, 'useCase', 30) },
    { ip: clientIp(await headers()), mail },
  );
  if (result.ok) return { sentTo: email.trim().toLowerCase() };
  const errors: Record<RequestFailure, string> = {
    invalid: d.errors.invalid, email: d.errors.email, disposable: d.errors.disposable,
    rate: d.errors.rate, limit: d.errors.limit, unavailable: t.demoUnavailable,
  };
  return { error: errors[result.error], field: result.error === 'email' || result.error === 'disposable' ? 'email' : undefined };
}

/** Opens the demo for the person whose link this is: signs them in to a fresh demo org, with a server-side session record. */
export async function openDemo(token: string): Promise<DemoState> {
  const { t } = await getI18n();
  const h = await headers();
  if (typeof token !== 'string' || token.length < 20 || token.length > 100) return { error: t.demoAccess.errors.link };
  if (!(await hit(RULES.demoVerifyIp, clientIp(h))).allowed) return { error: t.demoAccess.errors.rate };
  const claim = await claimDemoAccess(token);
  if (!claim.ok) return { error: claim.error === 'invalid' ? t.demoAccess.errors.link : claim.error === 'limit' ? t.demoAccess.errors.limit : t.demoUnavailable };
  const demo = claim.session;

  const session = await getSession();
  // A demo replaces whoever was signed in here: their session record ends and nothing of it stays in the cookie.
  if (session.sid) await endRecord(session.sid);
  clearPending(session);
  session.sid = await createRecord(demo.userId, demo.orgId, h.get('user-agent'));
  session.userId = demo.userId;
  session.orgId = demo.orgId;
  session.email = demo.email;
  session.demo = true;
  session.clientId = undefined;
  await session.save();
  // Straight into the sample catalogue, on its risky rows.
  const sample = await db.catalog.findFirst({ where: { orgId: demo.orgId }, orderBy: { createdAt: 'desc' }, select: { id: true } });
  redirect(sample ? `/catalogs/${sample.id}` : '/catalogs');
}
