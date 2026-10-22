// Demo access by e-mail: a visitor asks for a demo, receives a single-use link, and opening it creates
// their throwaway demo org. No manual approval. Only the hash of the link's token is stored. Limits:
// requests per address and per mailbox, demos per mailbox per day, link lifetime, throwaway providers.
import { createHash, randomBytes } from 'node:crypto';
import { absoluteUrl } from './app-url.js';
import { db } from './db.js';
import { startDemoSession, type DemoSession } from './demo.js';
import { demoLinkMinutes, demoMaxLive, demoMaxPerEmail } from './demo-config.js';
import { canonicalEmail, checkDemoEmail, normalizeEmail } from './demo-email.js';
import { mailEnabled, sendMail } from './mailer.js';
import { hit, RULES } from './security/rate-limit.js';

import { DEMO_LIMITS, USE_CASES, type UseCase } from './demo-access-fields.js';

export { DEMO_LIMITS, USE_CASES, type UseCase };

export type DemoRequestInput = { name: string; company: string; email: string; useCase: string };
export type DemoMail = { subject: string; body: (link: string, minutes: number) => string };

export type RequestFailure = 'invalid' | 'email' | 'disposable' | 'rate' | 'limit' | 'unavailable';
export type RequestResult = { ok: true; sent: boolean; link: string | null } | { ok: false; error: RequestFailure };

const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');
const DAY_MS = 86_400_000;

function clean(input: DemoRequestInput): { name: string; company: string; email: string; useCase: UseCase } | null {
  const name = input.name.trim().replace(/\s+/g, ' ');
  const company = input.company.trim().replace(/\s+/g, ' ');
  const useCase = USE_CASES.find((u) => u === input.useCase);
  if (!name || name.length > DEMO_LIMITS.name || !company || company.length > DEMO_LIMITS.company || !useCase) return null;
  return { name, company, email: normalizeEmail(input.email), useCase };
}

/** Verified demos of this mailbox in the last day. */
async function recentGrants(emailKey: string, now: Date): Promise<number> {
  return db.demoRequest.count({ where: { emailKey, verifiedAt: { not: null }, createdAt: { gt: new Date(now.getTime() - DAY_MS) } } });
}

/**
 * Records a request and e-mails the link. In production the link is sent only through SMTP; without a
 * mail server the request is refused rather than letting anyone in unverified. Outside production the
 * link is returned (and logged) so the flow can be tried locally.
 */
export async function requestDemoAccess(input: DemoRequestInput, ctx: { ip: string; mail: DemoMail }, now = new Date()): Promise<RequestResult> {
  const data = clean(input);
  if (!data) return { ok: false, error: 'invalid' };
  const verdict = checkDemoEmail(data.email);
  if (verdict !== 'ok') return { ok: false, error: verdict === 'invalid' ? 'email' : 'disposable' };

  const emailKey = canonicalEmail(data.email);
  if (!(await hit(RULES.demoRequestIp, ctx.ip, now)).allowed) return { ok: false, error: 'rate' };
  if (!(await hit(RULES.demoRequestEmail, emailKey, now)).allowed) return { ok: false, error: 'rate' };
  if (await recentGrants(emailKey, now) >= demoMaxPerEmail()) return { ok: false, error: 'limit' };
  const live = await db.organization.count({ where: { kind: 'demo', expiresAt: { gt: now } } });
  const production = process.env['NODE_ENV'] === 'production';
  if (live >= demoMaxLive() || (production && !mailEnabled())) return { ok: false, error: 'unavailable' };

  const token = randomBytes(32).toString('base64url');
  const minutes = demoLinkMinutes();
  // Only the newest link works: an earlier unused one for the same mailbox is dropped.
  const [, created] = await db.$transaction([
    db.demoRequest.deleteMany({ where: { emailKey, verifiedAt: null } }),
    db.demoRequest.create({
      data: {
        email: data.email, emailKey, name: data.name, company: data.company, useCase: data.useCase,
        tokenHash: hashToken(token), expiresAt: new Date(now.getTime() + minutes * 60_000), createdAt: now,
      },
      select: { id: true },
    }),
  ]);
  const link = absoluteUrl(`/demo/verify/${token}`);
  if (!mailEnabled()) {
    console.warn(`[demo] mail is off; access link for ${data.email}: ${link}`);
    return { ok: true, sent: false, link };
  }
  const sent = await sendMail({ to: data.email, subject: ctx.mail.subject, text: ctx.mail.body(link, minutes) });
  if (!sent) {
    await db.demoRequest.deleteMany({ where: { id: created.id } });
    return { ok: false, error: 'unavailable' };
  }
  return { ok: true, sent: true, link: production ? null : link };
}

/** What the confirmation page may show for a link that still works; does not use the link up. */
export async function peekDemoLink(token: string, now = new Date()): Promise<{ name: string } | null> {
  const row = await db.demoRequest.findUnique({ where: { tokenHash: hashToken(token) }, select: { name: true, verifiedAt: true, expiresAt: true } });
  return row && !row.verifiedAt && row.expiresAt > now ? { name: row.name } : null;
}

export type ClaimResult = { ok: true; session: DemoSession } | { ok: false; error: 'invalid' | 'limit' | 'unavailable' };

/** Uses the link up (atomically: two clicks cannot both win) and opens the demo org. */
export async function claimDemoAccess(token: string, now = new Date()): Promise<ClaimResult> {
  const tokenHash = hashToken(token);
  const claimed = await db.demoRequest.updateMany({ where: { tokenHash, verifiedAt: null, expiresAt: { gt: now } }, data: { verifiedAt: now } });
  if (claimed.count !== 1) return { ok: false, error: 'invalid' };
  const row = await db.demoRequest.findUniqueOrThrow({ where: { tokenHash }, select: { id: true, emailKey: true } });
  const release = async (): Promise<void> => { await db.demoRequest.updateMany({ where: { id: row.id, orgId: null }, data: { verifiedAt: null } }); };

  if (await recentGrants(row.emailKey, now) > demoMaxPerEmail()) return { ok: false, error: 'limit' };
  const live = await db.organization.count({ where: { kind: 'demo', expiresAt: { gt: now } } });
  if (live >= demoMaxLive()) { await release(); return { ok: false, error: 'unavailable' }; }
  const session = await startDemoSession(now);
  if (!session) { await release(); return { ok: false, error: 'unavailable' }; }
  await db.demoRequest.update({ where: { id: row.id }, data: { orgId: session.orgId } });
  return { ok: true, session };
}

/** Requests older than this many days are deleted by the daily job: they hold names and addresses. */
export function demoRequestRetentionDays(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env['DEMO_REQUEST_RETENTION_DAYS']);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 90;
}

export async function purgeDemoRequests(now = new Date(), days = demoRequestRetentionDays()): Promise<number> {
  const removed = await db.demoRequest.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - days * DAY_MS) } } });
  return removed.count;
}
