import type { Metadata } from 'next';
import { getI18n } from '@/lib/locale';
import { serverApi } from '@/lib/api/server';
import { AuthDivider, AuthSwitch } from '@/ui/auth-parts';
import { TelegramLogin } from '@/ui/telegram-login';
import { SignUpForm } from './sign-up-form';

export async function generateMetadata(): Promise<Metadata> {
  const { t, ta } = await getI18n();
  return { title: `${ta.signup.title} — ${t.appName}` };
}

export default async function SignUpPage() {
  const { t, ta } = await getI18n();
  const { telegramBot } = await serverApi().auth.config();
  return (
    <>
      <SignUpForm />
      {telegramBot ? (
        <>
          <AuthDivider label={ta.authX.signIn.or} />
          <TelegramLogin bot={telegramBot} />
        </>
      ) : null}
      <AuthSwitch text={ta.signup.have} href="/sign-in" action={t.signIn} />
    </>
  );
}
