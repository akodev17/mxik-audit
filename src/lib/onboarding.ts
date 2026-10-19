// First-run checklist on the dashboard. Every step is read from real data, so
// it ticks itself off when the work is done anywhere in the app.
import { db } from './db';
import { telegramConfig } from './telegram/config';

export type StepKey = 'client' | 'upload' | 'review' | 'invite' | 'twoFactor' | 'telegram';
export type Step = { key: StepKey; done: boolean; href: string };

export type OnboardingViewer = { orgId: string; userId: string; role: string; demo: boolean; clientIds?: string[] | null };

const DECIDED = ['finding.accepted', 'finding.rejected', 'finding.bulk_accepted', 'finding.bulk_rejected'];

/** Steps in order; the first one not done is the next action. Empty for demo orgs and viewers. */
export async function onboardingSteps(user: OnboardingViewer, now = new Date()): Promise<Step[]> {
  if (user.demo || user.role === 'viewer') return [];
  const admin = user.role === 'admin';
  const scope = user.clientIds ? { clientId: { in: user.clientIds } } : {};
  const [clients, catalogs, decided, me, colleagues, invites, ownChats] = await Promise.all([
    db.client.count({ where: { orgId: user.orgId, isDefault: false } }),
    db.catalog.count({ where: { orgId: user.orgId, ...scope } }),
    db.auditEvent.count({ where: { orgId: user.orgId, action: { in: DECIDED } } }),
    db.user.findUnique({ where: { id: user.userId }, select: { totpEnabledAt: true, telegramUserId: true } }),
    admin ? db.user.count({ where: { orgId: user.orgId, id: { not: user.userId } } }) : Promise.resolve(0),
    admin ? db.invite.count({ where: { orgId: user.orgId, usedAt: null, expiresAt: { gt: now } } }) : Promise.resolve(0),
    db.telegramLink.count({ where: { orgId: user.orgId, linkedBy: user.userId } }),
  ]);
  const steps: Step[] = [
    // A company that audits itself works in its default client: an upload counts as having a client.
    { key: 'client', done: clients > 0 || catalogs > 0, href: '/clients?new=1' },
    { key: 'upload', done: catalogs > 0, href: '/upload' },
    { key: 'review', done: decided > 0, href: '/queue' },
  ];
  if (admin) steps.push({ key: 'invite', done: colleagues > 0 || invites > 0, href: '/settings#team' });
  steps.push({ key: 'twoFactor', done: Boolean(me?.totpEnabledAt), href: '/settings#security' });
  if (telegramConfig().enabled) steps.push({ key: 'telegram', done: ownChats > 0 || Boolean(me?.telegramUserId), href: '/settings#telegram' });
  return steps;
}
