import type { Metadata } from 'next';
import Link from 'next/link';
import { getI18n } from '@/lib/locale';
import { MIN_PASSWORD } from '@/lib/security/password-check';
import { resetTarget } from '@/lib/security/password-reset';
import { EmptyState } from '@/ui/empty-state';
import { ResetForm } from './reset-form';

export async function generateMetadata(): Promise<Metadata> {
  const { t, ta } = await getI18n();
  // The token is in the URL: keep it out of Referer headers and search engines.
  return { title: `${ta.secX.reset.title} — ${t.appName}`, robots: { index: false, follow: false }, referrer: 'no-referrer' };
}

export default async function ResetPage({ params }: { params: Promise<{ token: string }> }) {
  const { t, ta } = await getI18n();
  const { token } = await params;
  const email = await resetTarget(token);
  if (!email) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4">
        <EmptyState
          tone="danger" title={ta.secX.reset.bad} hint={ta.secX.reset.badHint}
          action={<Link href="/sign-in/forgot" className="text-brand hover:underline">{ta.secX.reset.again}</Link>}
        />
      </main>
    );
  }
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4">
      <p className="text-xl font-bold tracking-tight">{t.appName}</p>
      <p className="mb-6 mt-1 text-sm text-muted">{ta.secX.reset.intro(email)}</p>
      <ResetForm token={token} min={MIN_PASSWORD} />
    </main>
  );
}
