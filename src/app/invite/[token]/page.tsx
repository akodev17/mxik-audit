import type { Metadata } from 'next';
import { getI18n } from '@/lib/locale';
import Link from 'next/link';
import { readInvite } from '@/lib/invites';
import { EmptyState } from '@/ui/empty-state';
import { JoinForm } from './join-form';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: `${t.appName}`, robots: { index: false } };
}

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { t, ta } = await getI18n();
  const { token } = await params;
  const invite = await readInvite(token);
  if (!invite) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4">
        <EmptyState
          tone="danger" title={ta.team.inviteBad} hint={ta.team.inviteBadHint}
          action={<Link href="/sign-in" className="text-brand hover:underline">{t.signIn}</Link>}
        />
      </main>
    );
  }
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4">
      <p className="text-xl font-bold tracking-tight">{t.appName}</p>
      <p className="mb-6 mt-1 text-sm text-muted">{ta.team.inviteIntro(invite.orgName, ta.team.roles[invite.role])}</p>
      <JoinForm token={token} email={invite.email} />
    </main>
  );
}
