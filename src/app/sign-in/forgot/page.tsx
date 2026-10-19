import type { Metadata } from 'next';
import Link from 'next/link';
import { getI18n } from '@/lib/locale';
import { mailEnabled } from '@/lib/mailer';
import { ForgotForm } from './forgot-form';

export async function generateMetadata(): Promise<Metadata> {
  const { t, ta } = await getI18n();
  return { title: `${ta.secX.forgot.title} — ${t.appName}`, robots: { index: false } };
}

/** Password reset request. Without SMTP it says plainly that an administrator has to set the password. */
export default async function ForgotPage() {
  const { t, ta } = await getI18n();
  const mail = mailEnabled();
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4">
      <Link href="/sign-in" className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-fg">
        <span aria-hidden>←</span> {ta.secX.backToSignIn}
      </Link>
      <p className="mb-6 text-xl font-bold tracking-tight">{t.appName}</p>
      {mail ? <ForgotForm /> : (
        <div className="space-y-2 rounded-ctl border border-line bg-base p-6 shadow-pop">
          <h1 className="text-lg">{ta.secX.forgot.title}</h1>
          <p role="status" className="text-sm">{ta.secX.forgot.noMail}</p>
        </div>
      )}
    </main>
  );
}
