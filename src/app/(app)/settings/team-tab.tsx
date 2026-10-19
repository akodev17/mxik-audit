import { isAdminRole } from '@/lib/access';
import { db } from '@/lib/db';
import { fmtDate } from '@/lib/format';
import { INVITE_DAYS } from '@/lib/invites';
import { getI18n } from '@/lib/locale';
import { mailEnabled } from '@/lib/mailer';
import { allows, planStatus } from '@/lib/plan';
import type { CurrentUser } from '@/lib/session';
import { Section } from '@/ui/page';
import { InviteForm } from './invite-form';
import { PendingInvites } from './pending-invites';
import { TeamMembers } from './team-members';

/** Admin only: members with role and client access, invites, pending invites. */
export async function TeamTab({ user }: { user: CurrentUser }) {
  if (!isAdminRole(user)) return null;
  const { locale, ta } = await getI18n();
  const s = ta.setX.team;
  const now = new Date();
  const [members, clients, invites, status] = await Promise.all([
    db.user.findMany({ where: { orgId: user.orgId }, orderBy: { createdAt: 'asc' }, select: { id: true, email: true, role: true, assignments: { select: { clientId: true } } } }),
    db.client.findMany({ where: { orgId: user.orgId }, orderBy: { name: 'asc' }, select: { id: true, name: true, archivedAt: true } }),
    db.invite.findMany({ where: { orgId: user.orgId, usedAt: null, expiresAt: { gt: now } }, orderBy: { createdAt: 'desc' }, select: { id: true, email: true, role: true, clientIds: true, expiresAt: true } }),
    planStatus(user.orgId, now),
  ]);
  const seats = allows(status, 'seats');

  return (
    <>
      <Section title={s.title} hint={s.hint}>
        <TeamMembers
          members={members.map((m) => ({ id: m.id, email: m.email, role: m.role, clientIds: m.assignments.map((a) => a.clientId), you: m.id === user.userId }))}
          clients={clients.map((c) => ({ id: c.id, name: c.name, archived: c.archivedAt !== null }))}
        />
      </Section>
      <Section title={s.invite.title}>
        <InviteForm
          clients={clients.map((c) => ({ id: c.id, name: c.name, archived: c.archivedAt !== null }))}
          mailOn={mailEnabled()} days={INVITE_DAYS}
          blocked={seats.ok ? null : seats.reason === 'expired' ? ta.msg.gate.expired : s.invite.seatsFull}
        />
      </Section>
      <Section title={s.pending.title}>
        <PendingInvites invites={invites.map((i) => ({ id: i.id, email: i.email, role: i.role, clients: i.clientIds.length, expires: fmtDate(locale, i.expiresAt) }))} />
      </Section>
    </>
  );
}
