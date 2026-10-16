import Link from 'next/link';
import { t } from '@/lib/i18n';
import { ta } from '@/lib/i18n-app';
import { telegramConfig } from '@/lib/telegram/config';
import { TelegramLogin } from '@/ui/telegram-login';
import { SignInForm } from './sign-in-form';

const NOTICES: Record<string, string> = {
  telegram: 'Telegram orqali kirib boʻlmadi. Qayta urinib koʻring yoki parol bilan kiring.',
  verify: 'Tasdiqlash havolasi yaroqsiz yoki muddati tugagan. Qaytadan roʻyxatdan oʻting.',
};

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const tg = telegramConfig();
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4">
      <Link href="/" className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-fg">
        <span aria-hidden>←</span> {t.back}
      </Link>
      <Link href="/" className="text-xl font-bold tracking-tight">{t.appName}</Link>
      <p className="mb-6 mt-1 text-sm text-muted">{t.tagline}</p>
      <SignInForm notice={error ? NOTICES[error] ?? null : null} />
      {tg.enabled && tg.username ? <div className="mt-5 text-center"><TelegramLogin bot={tg.username} /></div> : null}
      <p className="mt-6 text-center text-sm text-muted">{ta.signup.noAccount} <Link href="/sign-up" className="font-medium text-brand hover:underline">{ta.signup.create}</Link></p>
    </main>
  );
}
