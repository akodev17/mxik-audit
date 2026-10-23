import type { Metadata } from 'next';
import { getI18n } from '@/lib/locale';
import Link from 'next/link';
import { serverApi } from '@/lib/api/server';
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
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4 py-10">
      <Link href="/" className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-fg"><span aria-hidden>←</span> {t.back}</Link>
      <Link href="/" className="text-xl font-bold tracking-tight">{t.appName}</Link>
      <p className="mb-6 mt-1 text-sm text-muted">{ta.signup.tagline}</p>
      <SignUpForm />
      {telegramBot ? <div className="mt-5 text-center"><TelegramLogin bot={telegramBot} /></div> : null}
      <p className="mt-6 text-center text-sm text-muted">{ta.signup.have} <Link href="/sign-in" className="font-medium text-brand hover:underline">{t.signIn}</Link></p>
    </main>
  );
}
