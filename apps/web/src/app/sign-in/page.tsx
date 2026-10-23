import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getI18n } from '@/lib/locale';
import { signedIn } from '@/lib/api/me';
import { serverApi } from '@/lib/api/server';
import { safeNext } from '@/lib/safe-next';
import { AuthDivider, AuthSwitch, AuthTitle } from '@/ui/auth-parts';
import { TelegramLogin } from '@/ui/telegram-login';
import { SignInForm } from './sign-in-form';

type Search = { error?: string; notice?: string; next?: string };

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: `${t.signIn} — ${t.appName}` };
}

export default async function SignInPage({ searchParams }: { searchParams: Promise<Search> }) {
  const { ta } = await getI18n();
  const { error, notice, next } = await searchParams;
  const landing = safeNext(next);
  if (await signedIn()) redirect(landing ?? '/dashboard');
  const { telegramBot } = await serverApi().auth.config();
  const problem = error ? ta.secX.notices[error] ?? ta.msg.notices[error] ?? null : null;
  const a = ta.authX.signIn;
  return (
    <>
      <AuthTitle title={a.title} lead={a.lead} />
      <SignInForm notice={problem} info={notice ? ta.secX.info[notice] ?? null : null} next={landing} offerResend={error === 'verify'} />
      {telegramBot ? (
        <>
          <AuthDivider label={a.or} />
          <TelegramLogin bot={telegramBot} />
        </>
      ) : null}
      <AuthSwitch text={ta.signup.noAccount} href="/sign-up" action={ta.signup.create} />
    </>
  );
}
