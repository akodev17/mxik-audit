import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { signedIn } from '@/lib/api/me';
import { serverApi } from '@/lib/api/server';
import { getI18n } from '@/lib/locale';
import { ButtonLink } from '@/ui/button';
import { IconUpload } from '@/ui/icons';
import { Page } from '@/ui/page';
import { PRODUCT_FILTERS, type ProductFilter } from './labels';
import { ProductsView } from './products-view';

export async function generateMetadata(): Promise<Metadata> {
  const { t, ta } = await getI18n();
  return { title: `${ta.productsX.title} — ${t.appName}` };
}

type Search = { q?: string; status?: string; client?: string; page?: string; product?: string };

/** The product catalogue: search, MXIK status chips, client filter, the drawer and the bulk actions. */
export default async function ProductsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const { ta } = await getI18n();
  const sp = await searchParams;
  const q = (sp.q ?? '').trim().slice(0, 100);
  const status: ProductFilter = (PRODUCT_FILTERS as readonly string[]).includes(sp.status ?? '') ? sp.status as ProductFilter : 'all';
  const client = sp.client?.slice(0, 64) ?? '';
  const page = Math.max(0, Math.floor(Number(sp.page) || 0));
  const listing = serverApi().products.list({ ...(q ? { q } : {}), ...(status !== 'all' ? { status } : {}), ...(client ? { client } : {}), page });
  listing.catch(() => undefined); // awaited below, after a missing session has redirected
  const user = await signedIn();
  if (!user) redirect('/sign-in');
  const data = await listing;
  const editable = user.role !== 'viewer';
  return (
    <Page
      title={ta.productsX.title} hint={ta.productsX.hint} wide
      actions={editable ? <ButtonLink href="/products/import" variant="primary" leadingIcon={<IconUpload size={16} />}>{ta.productsX.actions.import}</ButtonLink> : null}
    >
      <ProductsView key={`${q}|${status}|${client}|${page}`} q={q} status={status} client={client} page={page} initial={data} editable={editable} openId={sp.product ?? null} />
    </Page>
  );
}
