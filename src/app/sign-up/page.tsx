import Link from 'next/link';
import { t } from '@/lib/i18n';
import { ta } from '@/lib/i18n-app';
import { telegramConfig } from '@/lib/telegram/config';
import { TelegramLogin } from '@/ui/telegram-login';
import { SignUpForm } from './sign-up-form';

export const metadata = { title: `${ta.signup.title} — ${t.appName}` };

export default function SignUpPage() {
  const tg = telegramConfig();
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4 py-10">
      <Link href="/" className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-fg"><span aria-hidden>←</span> {t.back}</Link>
      <Link href="/" className="text-xl font-bold tracking-tight">{t.appName}</Link>
      <p className="mb-6 mt-1 text-sm text-muted">{ta.signup.tagline}</p>
      <SignUpForm />
      {tg.enabled && tg.username ? <div className="mt-5 text-center"><TelegramLogin bot={tg.username} /></div> : null}
      <p className="mt-6 text-center text-sm text-muted">{ta.signup.have} <Link href="/sign-in" className="font-medium text-brand hover:underline">{t.signIn}</Link></p>
    </main>
  );
}
