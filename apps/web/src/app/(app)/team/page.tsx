import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { isAdminRole } from '@/lib/access';
import { db } from '@/lib/db';
import { fmtDate } from '@/lib/format';
import { INVITE_DAYS } from '@/lib/invites';
import { getI18n } from '@/lib/locale';
import { mailEnabled } from '@/lib/mailer';
import { allows, planStatus } from '@/lib/plan';
import { currentUser, inDemoOrg } from '@/lib/session';
import { EmptyState } from '@/ui/empty-state';
import { Page, Section } from '@/ui/page';
import { InviteDialog } from './invite-dialog';
import { PendingInvites } from './pending-invites';
import { TeamMembers } from './team-members';

export async function generateMetadata(): Promise<Metadata> {
  const { t, ta } = await getI18n();
  return { title: `${ta.nav.team} — ${t.appName}` };
}

/**
 * Team management for administrators: members with role and client access, invitations with their
 * status. Every query is limited to the signed-in user's organisation, and every change goes through
 * the admin-only server actions in app/actions/team.ts; this page only decides what to show.
 */
export default async function TeamPage() {
  const { locale, ta } = await getI18n();
  const user = await currentUser();
  if (!user) redirect('/sign-in');
  const s = ta.setX.team;

  // Nothing is read for someone who may not manage the team.
  const demo = await inDemoOrg(user);
  if (!isAdminRole(user) || demo) {
    return (
      <Page title={ta.nav.team}>
        <EmptyState title={demo ? ta.setX.demoOnly : ta.setX.adminOnly(ta.nav.team)} />
      </Page>
    );
  }

  const now = new Date();
  const [members, clients, invites, status] = await Promise.all([
    db.user.findMany({ where: { orgId: user.orgId }, orderBy: { createdAt: 'asc' }, select: { id: true, email: true, role: true, assignments: { select: { clientId: true } } } }),
    db.client.findMany({ where: { orgId: user.orgId }, orderBy: { name: 'asc' }, select: { id: true, name: true, archivedAt: true } }),
    db.invite.findMany({ where: { orgId: user.orgId, usedAt: null }, orderBy: { createdAt: 'desc' }, take: 100, select: { id: true, email: true, role: true, clientIds: true, expiresAt: true } }),
    planStatus(user.orgId),
  ]);
  const seats = allows(status, 'seats');
  const clientOptions = clients.map((c) => ({ id: c.id, name: c.name, archived: c.archivedAt !== null }));
  const mailOn = mailEnabled();

  return (
    <Page
      title={ta.nav.team} hint={s.pageHint} wide
      actions={
        <InviteDialog
          clients={clientOptions} mailOn={mailOn} days={INVITE_DAYS}
          blocked={seats.ok ? null : seats.reason === 'expired' ? ta.msg.gate.expired : s.invite.seatsFull}
        />
      }
    >
      <Section title={s.title} hint={s.memberCount(members.length)}>
        <TeamMembers
          members={members.map((m) => ({ id: m.id, email: m.email, role: m.role, clientIds: m.assignments.map((a) => a.clientId), you: m.id === user.userId }))}
          clients={clientOptions}
        />
      </Section>
      <Section title={s.pending.title}>
        <PendingInvites
          mailOn={mailOn}
          invites={invites.map((i) => ({
            id: i.id, email: i.email, role: i.role, clients: i.clientIds.length,
            expires: fmtDate(locale, i.expiresAt), expired: i.expiresAt <= now,
          }))}
        />
      </Section>
    </Page>
  );
}
