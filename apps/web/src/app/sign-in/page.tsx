import { getI18n } from '@/lib/locale';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { signedIn } from '@/lib/api/me';
import { serverApi } from '@/lib/api/server';
import { safeNext } from '@/lib/safe-next';
import { TelegramLogin } from '@/ui/telegram-login';
import { SignInForm } from './sign-in-form';

type Search = { error?: string; notice?: string; next?: string };

export default async function SignInPage({ searchParams }: { searchParams: Promise<Search> }) {
  const { t, ta } = await getI18n();
  const { error, notice, next } = await searchParams;
  const landing = safeNext(next);
  if (await signedIn()) redirect(landing ?? '/dashboard');
  const { telegramBot } = await serverApi().auth.config();
  const problem = error ? ta.secX.notices[error] ?? ta.msg.notices[error] ?? null : null;
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4">
      <Link href="/" className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-fg">
        <span aria-hidden>←</span> {t.back}
      </Link>
      <Link href="/" className="text-xl font-bold tracking-tight">{t.appName}</Link>
      <p className="mb-6 mt-1 text-sm text-muted">{t.tagline}</p>
      <SignInForm notice={problem} info={notice ? ta.secX.info[notice] ?? null : null} next={landing} offerResend={error === 'verify'} />
      <p className="mt-3 text-center text-sm"><Link href="/sign-in/forgot" className="text-brand hover:underline">{ta.secX.forgotLink}</Link></p>
      {telegramBot ? <div className="mt-5 text-center"><TelegramLogin bot={telegramBot} /></div> : null}
      <p className="mt-6 text-center text-sm text-muted">{ta.signup.noAccount} <Link href="/sign-up" className="font-medium text-brand hover:underline">{ta.signup.create}</Link></p>
    </main>
  );
}
