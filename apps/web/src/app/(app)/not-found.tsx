import type { Metadata } from 'next';
import { getI18n } from '@/lib/locale';
import { ButtonLink } from '@/ui/button';
import { pageContainerClass } from '@/ui/page';
import { BackButton } from '@/ui/shell/back-button';
import { helpHref } from '@/ui/shell/nav';
import { NotFoundBody } from '@/ui/shell/not-found-body';

export async function generateMetadata(): Promise<Metadata> {
  const { t, ta } = await getI18n();
  return { title: `${ta.shellX.notFound.title} — ${t.appName}` };
}

/** A page or record inside the app that does not exist or is outside the user's access; the shell stays. */
export default async function AppNotFound() {
  const { locale, ta } = await getI18n();
  const n = ta.shellX.notFound;
  return (
    <div className={pageContainerClass()}>
      <NotFoundBody
        title={n.title}
        hint={n.hint}
        actions={(
          <>
            <ButtonLink href="/dashboard" variant="primary">{n.dashboard}</ButtonLink>
            <BackButton label={n.back} />
            <ButtonLink href="/catalogs">{n.catalogs}</ButtonLink>
            <ButtonLink href={helpHref(locale)} variant="ghost">{n.help}</ButtonLink>
          </>
        )}
      />
    </div>
  );
}
