// First-run checklist on the dashboard. Every step is read from real data, so
// it ticks itself off when the work is done anywhere in the app. A scoped
// member's steps count only the clients they may open. Security and Telegram
// are optional: they are offered, but they never keep the checklist open.
import { clientScope } from './access';
import { db } from '@tasnivo/db';
import { telegramConfig } from './telegram/config';

export type StepKey = 'client' | 'upload' | 'review' | 'export' | 'invite' | 'twoFactor' | 'telegram';
export type Step = { key: StepKey; done: boolean; href: string; optional: boolean };

export type OnboardingViewer = { orgId: string; userId: string; role: string; demo: boolean; clientIds?: string[] | null };

const DECIDED = ['finding.accepted', 'finding.rejected', 'finding.bulk_accepted', 'finding.bulk_rejected'];
/** The result left the app: a file or PDF downloaded, or a share link made. */
const DELIVERED = ['catalog.exported', 'catalog.pdf_exported', 'catalog.report_csv_exported', 'share.created'];

/** True when an event of these kinds names a catalogue in scope (deleted catalogues of those clients included). */
async function eventInScope(orgId: string, clientIds: string[] | null, actions: string[]): Promise<boolean> {
  if (!clientIds) return (await db.auditEvent.count({ where: { orgId, action: { in: actions } }, take: 1 })) > 0;
  if (clientIds.length === 0) return false;
  const rows = await db.$queryRaw<{ found: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM audit_event e
      WHERE e."orgId" = ${orgId} AND e.action = ANY(${actions})
        AND (
          e.payload->>'catalogId' IN (SELECT id FROM catalog WHERE "orgId" = ${orgId} AND "clientId" = ANY(${clientIds}))
          OR e.payload->>'catalogId' IN (
            SELECT t."targetId" FROM audit_event t
            WHERE t."orgId" = ${orgId} AND t.action = 'catalog.deleted' AND t.payload->>'clientId' = ANY(${clientIds}))
        )
    ) AS found`;
  return rows[0]?.found === true;
}

/** Where the export step leads: the newest audited catalogue in scope (its page offers the file, the PDF and a link). */
async function exportHref(orgId: string, clientIds: string[] | null): Promise<string> {
  const latest = await db.catalog.findFirst({
    where: { orgId, status: 'ready', ...(clientIds ? { clientId: { in: clientIds } } : {}) },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { id: true },
  });
  return latest ? `/catalogs/${latest.id}` : '/catalogs';
}

/** Steps in order; the first required one not done is the next action. Empty for demo orgs and viewers. */
export async function onboardingSteps(user: OnboardingViewer, now = new Date()): Promise<Step[]> {
  if (user.demo || user.role === 'viewer') return [];
  const admin = user.role === 'admin';
  const clientIds = user.clientIds ?? null;
  const scope = clientIds ? { clientId: { in: clientIds } } : {};
  const [clients, catalogs, decided, delivered, deliverHref, me, colleagues, invites, ownChats] = await Promise.all([
    db.client.count({ where: { orgId: user.orgId, isDefault: false, ...clientScope(user) } }),
    db.catalog.count({ where: { orgId: user.orgId, ...scope } }),
    eventInScope(user.orgId, clientIds, DECIDED),
    eventInScope(user.orgId, clientIds, DELIVERED),
    exportHref(user.orgId, clientIds),
    db.user.findUnique({ where: { id: user.userId }, select: { totpEnabledAt: true, telegramUserId: true } }),
    admin ? db.user.count({ where: { orgId: user.orgId, id: { not: user.userId } } }) : Promise.resolve(0),
    admin ? db.invite.count({ where: { orgId: user.orgId, usedAt: null, expiresAt: { gt: now } } }) : Promise.resolve(0),
    db.telegramLink.count({ where: { orgId: user.orgId, linkedBy: user.userId } }),
  ]);
  const steps: Step[] = [
    // A company that audits itself works in its default client: an upload counts as having a client.
    { key: 'client', done: clients > 0 || catalogs > 0, href: '/clients?new=1', optional: false },
    { key: 'upload', done: catalogs > 0, href: '/upload', optional: false },
    { key: 'review', done: decided, href: '/queue', optional: false },
    { key: 'export', done: delivered, href: deliverHref, optional: false },
  ];
  if (admin) steps.push({ key: 'invite', done: colleagues > 0 || invites > 0, href: '/team', optional: false });
  steps.push({ key: 'twoFactor', done: Boolean(me?.totpEnabledAt), href: '/settings?tab=security', optional: true });
  // Chats are linked in Integrations (admins only); everyone else binds Telegram sign-in under Security.
  if (telegramConfig().enabled) {
    steps.push({ key: 'telegram', done: ownChats > 0 || Boolean(me?.telegramUserId), href: admin ? '/settings?tab=integrations' : '/settings?tab=security', optional: true });
  }
  return steps;
}

/** The checklist stays on the dashboard while a required step is open; optional steps never keep it there. Pure. */
export const checklistOpen = (steps: readonly Pick<Step, 'done' | 'optional'>[]): boolean => steps.some((s) => !s.done && !s.optional);

/** Whether this person hid the checklist (User.onboardingHiddenAt; it used to be a per-browser cookie). */
export async function checklistHidden(userId: string): Promise<boolean> {
  const me = await db.user.findUnique({ where: { id: userId }, select: { onboardingHiddenAt: true } });
  return Boolean(me?.onboardingHiddenAt);
}

/** Hides the checklist for this person on every device, or shows it again. A demo visitor's choice is not saved. */
export async function setChecklistHidden(user: { userId: string; demo: boolean }, hidden: boolean, now = new Date()): Promise<void> {
  if (user.demo) return;
  await db.user.update({ where: { id: user.userId }, data: { onboardingHiddenAt: hidden ? now : null } });
}
