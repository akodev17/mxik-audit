import type { Metadata } from 'next';
import Link from 'next/link';
import { getI18n } from '@/lib/locale';
import { signedIn } from '@/lib/api/me';
import { ButtonLink } from '@/ui/button';
import { TasnivoLogo } from '@/ui/logo';
import { onest } from '@/ui/onest';
import { BackButton } from '@/ui/shell/back-button';
import { helpHref } from '@/ui/shell/nav';
import { NotFoundBody } from '@/ui/shell/not-found-body';
import { readTheme } from '@/ui/shell/server-prefs';

export async function generateMetadata(): Promise<Metadata> {
  const { t, ta } = await getI18n();
  return { title: `${ta.shellX.notFound.title} — ${t.appName}`, robots: { index: false } };
}

/** Any unknown address outside the app frame. Signed-in people get app links, others the public ones. */
export default async function NotFound() {
  const [{ locale, t, ta }, theme, user] = await Promise.all([getI18n(), readTheme(), signedIn().catch(() => null)]);
  const n = ta.shellX.notFound;
  return (
    <div className={`app ${onest.variable} flex min-h-dvh flex-col bg-surface`} data-theme={theme}>
      <header className="flex h-14 items-center border-b border-line bg-base px-4 sm:px-6">
        <Link href={user ? '/dashboard' : '/'} aria-label={user ? ta.shellX.nav.home : t.appName} className="rounded-ctl text-fg">
          <TasnivoLogo className="text-section" />
        </Link>
      </header>
      <main className="grid flex-1 place-items-center">
        <NotFoundBody
          title={n.title}
          hint={n.hint}
          actions={user ? (
            <>
              <ButtonLink href="/dashboard" variant="primary">{n.dashboard}</ButtonLink>
              <BackButton label={n.back} />
              <ButtonLink href={helpHref(locale)} variant="ghost">{n.help}</ButtonLink>
            </>
          ) : (
            <>
              <ButtonLink href="/" variant="primary">{n.home}</ButtonLink>
              <ButtonLink href="/sign-in">{n.signIn}</ButtonLink>
              <ButtonLink href={helpHref(locale)} variant="ghost">{n.help}</ButtonLink>
            </>
          )}
        />
      </main>
    </div>
  );
}
