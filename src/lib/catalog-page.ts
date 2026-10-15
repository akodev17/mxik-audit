// What every per-catalogue screen needs: the selected catalogue (scoped to the
// org) and the options for the switcher.
import { notFound } from 'next/navigation';
import type { CatalogOption } from '@/components/catalog-switcher';
import { listCatalogs, resolveCatalog } from './catalogs';

export async function catalogForPage(orgId: string, requested: string | undefined) {
  const catalog = await resolveCatalog(orgId, requested);
  // An id that is not this org's is indistinguishable from one that does not exist.
  if (requested && !catalog) notFound();
  const options: CatalogOption[] = (await listCatalogs(orgId)).map((c) => ({
    id: c.id,
    label: `${c.filename} · ${c.createdAt.toLocaleDateString('uz-UZ')} · ${c.rowCount.toLocaleString('uz-UZ')}`,
  }));
  return { catalog, options };
}
