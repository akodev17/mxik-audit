import { getI18n } from '@/lib/locale';
import { ButtonLink } from '@/ui/button';
import { pageContainerClass } from '@/ui/page';
import { helpHref } from '@/ui/shell/nav';
import { NotFoundBody } from '@/ui/shell/not-found-body';

/** A client that does not exist or is outside the user's access: the way out leads to the clients list. */
export default async function ClientNotFound() {
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
            <ButtonLink href="/clients">{ta.firmX.client.openClients}</ButtonLink>
            <ButtonLink href={helpHref(locale)} variant="ghost">{n.help}</ButtonLink>
          </>
        )}
      />
    </div>
  );
}
