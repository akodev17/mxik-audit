import type { Metadata } from 'next';
import { cache } from 'react';
import { signedIn } from '@/lib/api/me';
import { serverApi } from '@/lib/api/server';
import { getI18n } from '@/lib/locale';
import { AuthDivider, AuthResult, AuthSwitch, AuthTitle } from '@/ui/auth-parts';
import { ButtonLink } from '@/ui/button';
import { GoogleLogin } from '@/ui/google-login';
import { JoinAccount } from './join-account';
import { JoinForm } from './join-form';

type Params = { params: Promise<{ token: string }> };

const invitation = cache((token: string) => serverApi().team.readInvite({ token }));

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { t, ta } = await getI18n();
  const invite = await invitation((await params).token);
  return { title: `${invite ? ta.team.join : ta.team.inviteBad} — ${t.appName}`, robots: { index: false } };
}

/**
 * Signed in (a real org): join with that account when it may move (plan D5), else why and whom to
 * ask. Signed out: a new account with a password, Google, or sign in first and come back here.
 */
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
  const i = ta.authX.invite;
  const title = <AuthTitle title={i.title} lead={ta.team.inviteIntro(invite.orgName, ta.team.roles[invite.role])} />;
  const here = `/invite/${token}`;
  const me = await signedIn();

  if (me && !me.demo && !me.verified) {
    return (
      <>
        {title}
        <AuthResult tone="info" title={i.verifyFirst} action={<ButtonLink href="/sign-up/verify" variant="primary" size="lg" className="w-full">{i.verifyAction}</ButtonLink>} />
      </>
    );
  }
  if (me && !me.demo) {
    const check = await serverApi().team.joinCheck({ token });
    return (
      <>
        {title}
        <JoinAccount token={token} email={me.email} check={check} />
      </>
    );
  }

  const { google } = await serverApi().auth.config();
  return (
    <>
      {title}
      <JoinForm token={token} email={invite.email} />
      {google ? (
        <>
          <AuthDivider label={ta.authX.signIn.or} />
          <GoogleLogin label={ta.verifyX.google} next={here} />
        </>
      ) : null}
      <AuthSwitch text={i.haveAccount} href={`/sign-in?next=${encodeURIComponent(here)}`} action={i.signInToJoin} />
    </>
  );
}
