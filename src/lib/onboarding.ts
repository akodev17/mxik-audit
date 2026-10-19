// First-run checklist on the dashboard. Every step is read from real data, so
// it ticks itself off when the work is done anywhere in the app. A scoped
// member's steps count only the clients they may open.
import { clientScope } from './access';
import { db } from './db';
import { telegramConfig } from './telegram/config';

export type StepKey = 'client' | 'upload' | 'review' | 'invite' | 'twoFactor' | 'telegram';
export type Step = { key: StepKey; done: boolean; href: string };

export type OnboardingViewer = { orgId: string; userId: string; role: string; demo: boolean; clientIds?: string[] | null };

const DECIDED = ['finding.accepted', 'finding.rejected', 'finding.bulk_accepted', 'finding.bulk_rejected'];

/** True when someone made a decision on a catalogue in scope (deleted catalogues of those clients included). */
async function decidedInScope(orgId: string, clientIds: string[] | null): Promise<boolean> {
  if (!clientIds) return (await db.auditEvent.count({ where: { orgId, action: { in: DECIDED } }, take: 1 })) > 0;
  if (clientIds.length === 0) return false;
  const rows = await db.$queryRaw<{ found: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM audit_event e
      WHERE e."orgId" = ${orgId} AND e.action = ANY(${DECIDED})
        AND (
          e.payload->>'catalogId' IN (SELECT id FROM catalog WHERE "orgId" = ${orgId} AND "clientId" = ANY(${clientIds}))
          OR e.payload->>'catalogId' IN (
            SELECT t."targetId" FROM audit_event t
            WHERE t."orgId" = ${orgId} AND t.action = 'catalog.deleted' AND t.payload->>'clientId' = ANY(${clientIds}))
        )
    ) AS found`;
  return rows[0]?.found === true;
}

/** Steps in order; the first one not done is the next action. Empty for demo orgs and viewers. */
export async function onboardingSteps(user: OnboardingViewer, now = new Date()): Promise<Step[]> {
  if (user.demo || user.role === 'viewer') return [];
  const admin = user.role === 'admin';
  const clientIds = user.clientIds ?? null;
  const scope = clientIds ? { clientId: { in: clientIds } } : {};
  const [clients, catalogs, decided, me, colleagues, invites, ownChats] = await Promise.all([
    db.client.count({ where: { orgId: user.orgId, isDefault: false, ...clientScope(user) } }),
    db.catalog.count({ where: { orgId: user.orgId, ...scope } }),
    decidedInScope(user.orgId, clientIds),
    db.user.findUnique({ where: { id: user.userId }, select: { totpEnabledAt: true, telegramUserId: true } }),
    admin ? db.user.count({ where: { orgId: user.orgId, id: { not: user.userId } } }) : Promise.resolve(0),
    admin ? db.invite.count({ where: { orgId: user.orgId, usedAt: null, expiresAt: { gt: now } } }) : Promise.resolve(0),
    db.telegramLink.count({ where: { orgId: user.orgId, linkedBy: user.userId } }),
  ]);
  const steps: Step[] = [
    // A company that audits itself works in its default client: an upload counts as having a client.
    { key: 'client', done: clients > 0 || catalogs > 0, href: '/clients?new=1' },
    { key: 'upload', done: catalogs > 0, href: '/upload' },
    { key: 'review', done: decided, href: '/queue' },
  ];
  if (admin) steps.push({ key: 'invite', done: colleagues > 0 || invites > 0, href: '/settings?tab=team' });
  steps.push({ key: 'twoFactor', done: Boolean(me?.totpEnabledAt), href: '/settings?tab=security' });
  // Chats are linked in Integrations (admins only); everyone else binds Telegram sign-in under Security.
  if (telegramConfig().enabled) {
    steps.push({ key: 'telegram', done: ownChats > 0 || Boolean(me?.telegramUserId), href: admin ? '/settings?tab=integrations' : '/settings?tab=security' });
  }
  return steps;
}
