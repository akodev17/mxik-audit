'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { endpoints, ResponseOf } from '@tasnivo/contracts';
import { fmtNumber } from '@tasnivo/i18n/format';
import { api } from '@/lib/api/browser';
import { isNetworkFailure } from '@/lib/api-failure';
import { useI18n } from '@/lib/locale-client';
import { StatusChip } from '@/ui/badge';
import { Button, ButtonLink } from '@/ui/button';
import { CodeChip } from '@/ui/code-chip';
import { cx } from '@/ui/cx';
import { EmptyState } from '@/ui/empty-state';
import { IconSearch, IconTable } from '@/ui/icons';
import { Input } from '@/ui/input';
import { Progress } from '@/ui/progress';
import { Select } from '@/ui/select';
import { Table, Td, Th, Tr } from '@/ui/table';
import { useToast } from '@/ui/toast';
import { fill, issueText, PRODUCT_FILTERS, STATUS_TONE, type ProductFilter } from './labels';
import { ProductDrawer } from './product-drawer';

export type ProductList = ResponseOf<typeof endpoints.products.list>;
export type ProductRowData = ProductList['rows'][number];

/** Every product listing in the cache; a confirmation or a check refetches the one on screen. */
export const PRODUCTS = ['products'] as const;

type Props = { q: string; status: ProductFilter; client: string; page: number; initial: ProductList; editable: boolean; openId: string | null };

/** Search, client filter, status chips with counts, the table, the pager, the drawer and the bulk actions. */
export function ProductsView({ q, status, client, page, initial, editable, openId }: Props) {
  const { ta, locale } = useI18n();
  const x = ta.productsX;
  const router = useRouter();
  const toast = useToast();
  const queryClient = useQueryClient();
  const key = [...PRODUCTS, { q, status, client, page }];
  const { data } = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => api.products.list({ ...(q ? { q } : {}), ...(status !== 'all' ? { status } : {}), ...(client ? { client } : {}), page }, { signal }),
    initialData: initial, staleTime: Infinity, gcTime: 0,
  });
  // A new server render of the same URL brings a fresh copy.
  useEffect(() => { queryClient.setQueryData([...PRODUCTS, { q, status, client, page }], initial); }, [queryClient, q, status, client, page, initial]);
  const [open, setOpen] = useState<string | null>(openId);
  const [checking, setChecking] = useState<{ done: number; total: number } | null>(null);
  const [exporting, setExporting] = useState(false);
  const refetch = (): void => { void queryClient.invalidateQueries({ queryKey: PRODUCTS }); };

  const href = (over: { status?: ProductFilter; client?: string; page?: number }): string => {
    const s = over.status ?? status;
    const c = over.client ?? client;
    const params = new URLSearchParams({ ...(q ? { q } : {}), ...(s !== 'all' ? { status: s } : {}), ...(c ? { client: c } : {}), ...(over.page ? { page: String(over.page) } : {}) });
    const text = params.toString();
    return text ? `/products?${text}` : '/products';
  };

  // The open product stays in state only: rewriting the address would remount the page (ui/shell/navigation.ts).
  // `?product=` still opens one on arrival (links from elsewhere).
  const openProduct = (id: string | null): void => setOpen(id);

  // "Check unchecked": chunks of 100 until none is left, with the progress on screen.
  async function checkUnchecked(): Promise<void> {
    const total = data.counts.unchecked;
    let done = 0;
    setChecking({ done, total });
    try {
      for (;;) {
        const r = await api.products.check({ unchecked: true, ...(client && client !== 'own' ? { clientId: client } : {}) });
        done += r.checked;
        setChecking({ done, total: Math.max(total, done + r.remaining) });
        if (r.checked === 0 || r.remaining === 0) break;
      }
      toast(fill(x.toast.checked, { n: fmtNumber(locale, done) }), { tone: 'ok' });
    } catch (error) {
      toast(isNetworkFailure(error) ? x.toast.network : x.toast.failed, { tone: 'error' });
    } finally {
      setChecking(null);
      refetch();
    }
  }

  async function exportToOneC(): Promise<void> {
    setExporting(true);
    try {
      const r = await api.products.exportAll({ ...(client && client !== 'own' ? { clientId: client } : {}), ...(status !== 'all' ? { status } : {}) });
      if (r.ok) {
        toast(fill(x.toast.exportReady, { n: fmtNumber(locale, r.records) }), { tone: 'ok', action: { label: x.importWizard.download, run: () => { window.location.href = `/api/onec/exports/${r.exportId}/file`; } } });
      }
      else toast(r.error, { tone: r.unavailable ? 'ok' : 'error' });
    } catch (error) {
      toast(isNetworkFailure(error) ? x.toast.network : x.toast.failed, { tone: 'error' });
    } finally {
      setExporting(false);
    }
  }

  const { counts, rows, total, pageSize, clients } = data;
  const nothingAtAll = counts.all === 0 && !q && !client;
  return (
    <>
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <form action="/products" className="min-w-56 flex-1" role="search">
          {status !== 'all' ? <input type="hidden" name="status" value={status} /> : null}
          {client ? <input type="hidden" name="client" value={client} /> : null}
          <Input name="q" defaultValue={q} placeholder={x.search} aria-label={x.search} leadingIcon={<IconSearch size={16} />} />
        </form>
        {clients.length > 0 ? (
          <Select aria-label={x.columns.client} value={client} onChange={(e) => router.push(href({ client: e.target.value, page: 0 }))} wrapperClassName="w-56">
            <option value="">{x.allClients}</option>
            <option value="own">{x.orgOwn}</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        ) : null}
        {editable && counts.unchecked > 0 ? (
          <Button variant="secondary" loading={checking !== null} onClick={() => void checkUnchecked()}>{x.actions.checkUnchecked}</Button>
        ) : null}
        {editable && counts.all > 0 ? <Button variant="secondary" loading={exporting} onClick={() => void exportToOneC()}>{x.actions.export1c}</Button> : null}
      </div>
      {checking ? <Progress className="mb-3" label={x.drawer.checking} value={checking.done} max={Math.max(1, checking.total)} valueText={fill(x.importWizard.progress, { done: checking.done, total: checking.total })} /> : null}

      {counts.all > 0 ? (
        <nav aria-label={x.filterLabel} className="mb-3 flex flex-wrap items-center gap-2">
          {PRODUCT_FILTERS.filter((f) => f === 'all' || f === status || counts[f] > 0).map((f) => {
            const on = f === status;
            return (
              <Link
                key={f} href={href({ status: f, page: 0 })} aria-current={on ? 'true' : undefined}
                className={cx(
                  'inline-flex h-7 items-center gap-1.5 rounded-full border pl-3 pr-1.5 text-small font-medium transition-colors duration-(--duration-fast)',
                  on ? 'border-brand bg-brand-tint text-brand-ink' : 'border-line-strong bg-raised text-fg hover:bg-surface',
                )}
              >
                {x.status[f]}
                <span className={cx('inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-micro tabular-nums', on ? 'bg-raised text-brand-ink' : 'bg-sunken text-muted')}>{fmtNumber(locale, counts[f])}</span>
              </Link>
            );
          })}
        </nav>
      ) : null}

      {rows.length === 0 ? (
        nothingAtAll
          ? <EmptyState icon={<IconTable size={20} />} title={x.empty.title} hint={x.empty.hint} action={editable ? <ButtonLink href="/products/import" variant="primary">{x.actions.import}</ButtonLink> : null} />
          : <EmptyState icon={<IconSearch size={20} />} title={x.empty.filtered} action={<ButtonLink size="sm" variant="secondary" href="/products">{x.status.all}</ButtonLink>} />
      ) : (
        <>
          <h2 className="mb-2 text-section">{fill(x.counts, { n: fmtNumber(locale, total) })}</h2>
          <Table label={x.title} hoverRows density="compact">
            <thead>
              <tr>
                <Th>{x.columns.name}</Th>
                <Th>{x.columns.mxik}</Th>
                <Th className="hidden md:table-cell">{x.columns.package}</Th>
                <Th>{x.columns.unit}</Th>
                <Th className="hidden lg:table-cell">{x.columns.barcode}</Th>
                <Th>{x.columns.status}</Th>
                {clients.length > 0 ? <Th className="hidden lg:table-cell">{x.columns.client}</Th> : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const first = r.issues.find((i) => i.severity !== 'info');
                return (
                  <Tr key={r.id} interactive selected={r.id === open} onClick={() => openProduct(r.id)}>
                    <Td className="max-w-80">
                      <button type="button" className="block max-w-full truncate text-left font-medium text-fg hover:underline" title={r.name} onClick={(e) => { e.stopPropagation(); openProduct(r.id); }}>{r.name}</button>
                      {r.onecRef ? <span className="text-micro text-muted">{x.columns.onecRef}: {r.onecRef}</span> : null}
                    </Td>
                    <Td className="max-w-72">
                      {r.mxik ? <CodeChip code={r.mxik} /> : <span className="text-muted">—</span>}
                      {r.mxikName ? <span className="block truncate text-micro text-muted" title={r.mxikName}>{r.mxikName}</span> : null}
                    </Td>
                    <Td className="hidden md:table-cell">
                      {r.packageCode ? <span className="tabular-nums">{r.packageCode}</span> : <span className="text-muted">—</span>}
                      {r.packageName ? <span className="block max-w-48 truncate text-micro text-muted" title={r.packageName}>{r.packageName}</span> : null}
                    </Td>
                    <Td>{r.unit ?? <span className="text-muted">—</span>}</Td>
                    <Td className="hidden tabular-nums lg:table-cell">{r.barcode ?? <span className="text-muted">—</span>}</Td>
                    <Td>
                      <StatusChip tone={STATUS_TONE[r.mxikStatus]}>{x.status[r.mxikStatus]}</StatusChip>
                      {first ? <span className="mt-0.5 block max-w-56 truncate text-micro text-muted" title={issueText(x.issues, first)}>{issueText(x.issues, first)}</span> : null}
                    </Td>
                    {clients.length > 0 ? <Td className="hidden text-muted lg:table-cell">{r.clientName ?? x.orgOwn}</Td> : null}
                  </Tr>
                );
              })}
            </tbody>
          </Table>
          {page > 0 || (page + 1) * pageSize < total ? (
            <nav aria-label={x.pager.label} className="mt-3 flex flex-wrap items-center justify-end gap-2">
              {page > 0 ? <ButtonLink size="sm" variant="ghost" href={href({ page: page - 1 })}>{x.pager.prev}</ButtonLink> : null}
              {(page + 1) * pageSize < total ? <ButtonLink size="sm" variant="secondary" href={href({ page: page + 1 })}>{x.pager.next}</ButtonLink> : null}
            </nav>
          ) : null}
        </>
      )}
      <ProductDrawer productId={open} editable={editable} onClose={() => openProduct(null)} onChanged={refetch} />
    </>
  );
}
