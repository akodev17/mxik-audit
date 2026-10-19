// What every per-catalogue screen needs: the selected catalogue (scoped to the
// org and the user's clients), its client, and the switcher options for that
// client's catalogues.
import { notFound } from 'next/navigation';
import { resolveVisibleClient } from './active-client';
import { listCatalogs, resolveCatalog } from './catalogs';
import { resolveClient } from './clients';
import type { CurrentUser } from './session';

export async function catalogForPage(user: Pick<CurrentUser, 'orgId' | 'clientId' | 'clientIds'>, requested: string | undefined) {
  // Without an explicit catalogue, show the latest of the client being worked on, if the user may still see it.
  const active = requested ? null : await resolveVisibleClient(user);
  const catalog = await resolveCatalog(user.orgId, requested, active?.id ?? null, user.clientIds);
  // An id that is not this org's is indistinguishable from one that does not exist.
  if (requested && !catalog) notFound();
  const client = catalog?.clientId && catalog.clientId !== active?.id
    ? await resolveClient(user.orgId, catalog.clientId)
    : active;
  const options: { id: string; label: string }[] = client
    ? (await listCatalogs(user.orgId, client.id)).map((c) => ({
      id: c.id,
      label: `${c.filename} · ${c.createdAt.toLocaleDateString('uz-UZ')} · ${c.rowCount.toLocaleString('uz-UZ')}`,
    }))
    : [];
  return { catalog, options, client };
}
