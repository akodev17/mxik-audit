import type { Metadata } from 'next';
import { getI18n } from '@/lib/locale';
import { currentUser } from '@/lib/session';
import { ButtonLink } from '@/ui/button';
import { onest } from '@/ui/onest';
import { helpHref } from '@/ui/shell/nav';
import { NotFoundBody } from '@/ui/shell/not-found-body';
import { readTheme } from '@/ui/shell/server-prefs';

export async function generateMetadata(): Promise<Metadata> {
  const { t, ta } = await getI18n();
  return { title: `${ta.shellX.notFound.title} — ${t.appName}`, robots: { index: false } };
}

/** Any unknown address outside the app frame. Signed-in people get app links, others the public ones. */
export default async function NotFound() {
  const [{ locale, ta }, theme, user] = await Promise.all([getI18n(), readTheme(), currentUser().catch(() => null)]);
  const n = ta.shellX.notFound;
  return (
    <div className={`app ${onest.variable} grid min-h-dvh place-items-center bg-surface`} data-theme={theme}>
      <main>
        <NotFoundBody
          title={n.title}
          hint={n.hint}
          actions={user ? (
            <>
              <ButtonLink href="/dashboard" variant="primary">{n.dashboard}</ButtonLink>
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
