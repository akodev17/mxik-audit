import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getI18n } from '@/lib/locale';
import { signedIn } from '@/lib/api/me';
import { serverApi } from '@/lib/api/server';
import { safeNext } from '@/lib/safe-next';
import { AuthDivider, AuthSwitch, AuthTitle } from '@/ui/auth-parts';
import { GoogleLogin } from '@/ui/google-login';
import { SignInForm } from './sign-in-form';
import { TelegramSignIn } from './telegram-sign-in';

type Search = { error?: string; notice?: string; next?: string };

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: `${t.signIn} — ${t.appName}` };
}

export default async function SignInPage({ searchParams }: { searchParams: Promise<Search> }) {
  const { ta } = await getI18n();
  const { error, notice, next } = await searchParams;
  const landing = safeNext(next);
  const me = await signedIn();
  if (me) redirect(me.verified ? landing ?? '/dashboard' : '/sign-up/verify');
  const { telegramBot, google } = await serverApi().auth.config();
  const problem = error ? ta.secX.notices[error] ?? ta.msg.notices[error] ?? ta.verifyX.notices[error] ?? null : null;
  const a = ta.authX.signIn;
  return (
    <>
      <AuthTitle title={a.title} lead={a.lead} />
      <SignInForm notice={problem} info={notice ? ta.secX.info[notice] ?? null : null} next={landing} offerResend={error === 'verify'} />
      {telegramBot || google ? (
        <>
          <AuthDivider label={a.or} />
          <div className="space-y-3">
            {google ? <GoogleLogin label={ta.verifyX.google} next={landing} /> : null}
            {telegramBot ? <TelegramSignIn bot={telegramBot} /> : null}
          </div>
        </>
      ) : null}
      <AuthSwitch text={ta.signup.noAccount} href="/sign-up" action={ta.signup.create} />
    </>
  );
}
