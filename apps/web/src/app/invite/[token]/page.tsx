import type { Metadata } from 'next';
import { cache } from 'react';
import { serverApi } from '@/lib/api/server';
import { getI18n } from '@/lib/locale';
import { AuthResult, AuthTitle } from '@/ui/auth-parts';
import { ButtonLink } from '@/ui/button';
import { JoinForm } from './join-form';

type Params = { params: Promise<{ token: string }> };

const invitation = cache((token: string) => serverApi().team.readInvite({ token }));

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
      <AuthResult
        tone="danger" role="none" title={ta.team.inviteBad}
        action={<ButtonLink href="/sign-in" variant="secondary" size="lg" className="w-full">{t.signIn}</ButtonLink>}
      >
        <p>{ta.team.inviteBadHint}</p>
      </AuthResult>
    );
  }
  return (
    <>
      <AuthTitle title={ta.authX.invite.title} lead={ta.team.inviteIntro(invite.orgName, ta.team.roles[invite.role])} />
      <JoinForm token={token} email={invite.email} />
    </>
  );
}
