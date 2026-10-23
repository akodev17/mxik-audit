import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getI18n } from '@/lib/locale';
import { signedIn } from '@/lib/api/me';
import { serverApi } from '@/lib/api/server';
import { AuthDivider, AuthSwitch } from '@/ui/auth-parts';
import { GoogleLogin } from '@/ui/google-login';
import { TelegramLogin } from '@/ui/telegram-login';
import { SignUpForm } from './sign-up-form';

export async function generateMetadata(): Promise<Metadata> {
  const { t, ta } = await getI18n();
  return { title: `${ta.signup.title} — ${t.appName}` };
}

export default async function SignUpPage() {
  const { t, ta } = await getI18n();
  // Signed in with an unconfirmed address (back from the code step): finish that first.
  const me = await signedIn();
  if (me && !me.verified) redirect('/sign-up/verify');
  const { telegramBot, google } = await serverApi().auth.config();
  return (
    <>
      <SignUpForm />
      {telegramBot || google ? (
        <>
          <AuthDivider label={ta.authX.signIn.or} />
          <div className="space-y-3">
            {google ? <GoogleLogin label={ta.verifyX.google} /> : null}
            {telegramBot ? <TelegramLogin bot={telegramBot} /> : null}
          </div>
        </>
      ) : null}
      <AuthSwitch text={ta.signup.have} href="/sign-in" action={t.signIn} />
    </>
  );
}
