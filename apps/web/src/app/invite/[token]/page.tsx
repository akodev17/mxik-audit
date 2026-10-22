import type { Metadata } from 'next';
import Link from 'next/link';
import { cache } from 'react';
import { readInvite } from '@tasnivo/domain/invites';
import { getI18n } from '@/lib/locale';
import { EmptyState } from '@/ui/empty-state';
import { JoinForm } from './join-form';

type Params = { params: Promise<{ token: string }> };

const invitation = cache(readInvite);

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { t, ta } = await getI18n();
  const invite = await invitation((await params).token);
  return { title: `${invite ? ta.team.join : ta.team.inviteBad} — ${t.appName}`, robots: { index: false } };
}

export default async function InvitePage({ params }: Params) {
  const { t, ta } = await getI18n();
  const { token } = await params;
  const invite = await invitation(token);
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
