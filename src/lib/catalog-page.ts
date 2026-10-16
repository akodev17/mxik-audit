// What every per-catalogue screen needs: the selected catalogue (scoped to the
// org), its client, and the switcher options for that client's catalogues.
import { notFound } from 'next/navigation';
import { listCatalogs, resolveCatalog } from './catalogs';
import { resolveClient } from './clients';

export async function catalogForPage(user: { orgId: string; clientId: string | null }, requested: string | undefined) {
  // Without an explicit catalogue, show the latest of the client being worked on.
  const active = await resolveClient(user.orgId, user.clientId);
  const catalog = await resolveCatalog(user.orgId, requested, requested ? null : active.id);
  // An id that is not this org's is indistinguishable from one that does not exist.
  if (requested && !catalog) notFound();
  const client = catalog?.clientId && catalog.clientId !== active.id
    ? await resolveClient(user.orgId, catalog.clientId)
    : active;
  const options: { id: string; label: string }[] = (await listCatalogs(user.orgId, client.id)).map((c) => ({
    id: c.id,
    label: `${c.filename} · ${c.createdAt.toLocaleDateString('uz-UZ')} · ${c.rowCount.toLocaleString('uz-UZ')}`,
  }));
  return { catalog, options, client };
}
