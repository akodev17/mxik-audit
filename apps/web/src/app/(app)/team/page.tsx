import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { signedIn } from '@/lib/api/me';
import { serverApi } from '@/lib/api/server';
import { getI18n } from '@/lib/locale';
import { EmptyState } from '@/ui/empty-state';
import { Page, Section } from '@/ui/page';
import { InviteDialog } from './invite-dialog';
import { PendingInvites } from './pending-invites';
import { MembersSection } from './team-members';

export async function generateMetadata(): Promise<Metadata> {
  const { t, ta } = await getI18n();
  return { title: `${ta.nav.team} — ${t.appName}` };
}

/**
 * Team management for administrators: members with role and client access, invitations with their
 * status. The API limits everything to the signed-in user's organisation and refuses changes from
 * anyone but an admin of a real org; this page only decides what to show.
 */
export default async function TeamPage() {
  const { ta } = await getI18n();
  const user = await signedIn();
  if (!user) redirect('/sign-in');
  const s = ta.setX.team;

  // Nothing is read for someone who may not manage the team.
  const demo = user.demo;
  if (user.role !== 'admin' || demo) {
    return (
      <Page title={ta.nav.team}>
        <EmptyState title={demo ? ta.setX.demoOnly : ta.setX.adminOnly(ta.nav.team)} />
      </Page>
    );
  }

  const [team, { status }] = await Promise.all([serverApi().team.list(), serverApi().billing.plan()]);

  return (
    <Page
      title={ta.nav.team} hint={s.pageHint} wide
      actions={<InviteDialog initial={team} expired={status.state === 'expired'} />}
    >
      <MembersSection initial={team} you={user.userId} />
      <Section title={s.pending.title}>
        <PendingInvites initial={team} />
      </Section>
    </Page>
  );
}
