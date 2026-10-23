// /onec: the import history of every batch (bank statements, Didox invoices, product catalogues)
// with its state, counts and exports; filtered by kind and state, by client through the header's
// client control (`?client=`), paged (docs/accounting-2026-10-23/onec-ui.md).
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { accounting } from '@tasnivo/contracts';
import { fmtDateTime, fmtNumber } from '@tasnivo/i18n/format';
import { signedIn } from '@/lib/api/me';
import { pageData } from '@/lib/api/page-data';
import { serverApi } from '@/lib/api/server';
import { getI18n } from '@/lib/locale';
import { isAdminRole } from '@/lib/pure/access';
import { withQuery } from '@/lib/pure/query-string';
import { StatusChip } from '@/ui/badge';
import { ButtonLink } from '@/ui/button';
import { cx } from '@/ui/cx';
import { EmptyState } from '@/ui/empty-state';
import { IconGear } from '@/ui/icons';
import { Page } from '@/ui/page';
import { Table, Td, Th } from '@/ui/table';
import { Card, FLUSH_TABLE } from '../_manage/card';
import { BATCH_TONE, type ImportKind, type ImportStatus } from './review/columns';

type Params = { kind?: string; status?: string; client?: string; page?: string };

export async function generateMetadata(): Promise<Metadata> {
  const { t, ta } = await getI18n();
  return { title: `${ta.accountingX.nav.onec} — ${t.appName}` };
}

const chip = (active: boolean): string => cx(
  'inline-flex h-7 items-center rounded-full border px-3 text-small font-medium transition-colors duration-(--duration-fast)',
  active ? 'border-transparent bg-fg text-inverse' : 'border-line bg-raised text-muted hover:border-line-strong hover:text-fg',
);

export default async function OnecPage({ searchParams }: { searchParams: Promise<Params> }) {
  const { locale, ta } = await getI18n();
  const user = await signedIn();
  if (!user) redirect('/sign-in');
  const sp = await searchParams;
  const a = ta.accountingX;
  const w = ta.onecX.list;
  const kind = accounting.IMPORT_KINDS.find((k) => k === sp.kind);
  const status = accounting.IMPORT_STATUSES.find((s) => s === sp.status);
  const client = sp.client && sp.client !== 'all' ? sp.client.slice(0, 64) : undefined;
  const page = Math.max(1, Math.floor(Number(sp.page)) || 1);
  const data = await pageData(serverApi().onec.batches({ page: page - 1, ...(kind ? { kind } : {}), ...(status ? { status } : {}), ...(client ? { client } : {}) }));
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  const params: Record<string, string | undefined> = { kind, status, client };
  const filtered = Boolean(kind || status);
  const n = (v: number): string => fmtNumber(locale, v);

  return (
    <Page
      title={a.nav.onec} hint={ta.onecX.hint} wide
      actions={<ButtonLink href="/onec/settings" size="sm" variant="secondary" leadingIcon={<IconGear size={14} />}>{isAdminRole(user) ? ta.onecX.settingsLink : ta.onecX.settings.counterparties}</ButtonLink>}
    >
      <div className="mb-4 space-y-2">
        <nav aria-label={w.colKind} className="flex flex-wrap items-center gap-1.5">
          <Link href={withQuery('/onec', params, { kind: null, page: null })} aria-current={!kind ? 'page' : undefined} className={chip(!kind)}>{w.allKinds}</Link>
          {accounting.IMPORT_KINDS.map((k: ImportKind) => (
            <Link key={k} href={withQuery('/onec', params, { kind: k, page: null })} aria-current={kind === k ? 'page' : undefined} className={chip(kind === k)}>{a.kinds[k]}</Link>
          ))}
        </nav>
        <nav aria-label={w.colStatus} className="flex flex-wrap items-center gap-1.5">
          <Link href={withQuery('/onec', params, { status: null, page: null })} aria-current={!status ? 'page' : undefined} className={chip(!status)}>{w.allStatuses}</Link>
          {accounting.IMPORT_STATUSES.map((s: ImportStatus) => (
            <Link key={s} href={withQuery('/onec', params, { status: s, page: null })} aria-current={status === s ? 'page' : undefined} className={chip(status === s)}>{a.status[s]}</Link>
          ))}
        </nav>
      </div>

      {data.rows.length === 0 ? (
        <Card>
          {filtered
            ? <EmptyState size="compact" title={w.filteredEmpty} action={<ButtonLink href={withQuery('/onec', { client })} variant="secondary">{w.reset}</ButtonLink>} />
            : <EmptyState size="compact" title={w.empty} hint={w.emptyHint} />}
        </Card>
      ) : (
        <>
          <p className="mb-2 text-small text-muted">{w.total(n(data.total), data.total)}</p>
          <Card flush>
            <Table label={a.nav.onec} className={FLUSH_TABLE} hoverRows>
              <thead>
                <tr>
                  <Th>{w.colSource}</Th>
                  <Th className="hidden sm:table-cell">{w.colKind}</Th>
                  <Th className="hidden md:table-cell">{w.colClient}</Th>
                  <Th>{w.colStatus}</Th>
                  <Th numeric>{w.colRecords}</Th>
                  <Th className="hidden md:table-cell">{w.colExports}</Th>
                  <Th className="hidden lg:table-cell">{w.colDate}</Th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((b) => {
                  const c = b.counts;
                  const pending = c ? c.unresolved + c.suspicious : 0;
                  return (
                    <tr key={b.id} className="align-top">
                      <Td className="max-w-[20rem] py-2.5">
                        <Link href={`/onec/${b.id}`} className="block truncate font-medium hover:text-brand-ink hover:underline" title={b.filename ?? b.id}>
                          {b.filename ?? b.externalRef ?? a.kinds[b.kind]}
                        </Link>
                        <span className="block text-small text-muted sm:hidden">{a.kinds[b.kind]}</span>
                      </Td>
                      <Td className="hidden whitespace-nowrap text-small sm:table-cell">{a.kinds[b.kind]}</Td>
                      <Td className="hidden max-w-[12rem] truncate text-small md:table-cell">{b.clientName ?? ta.onecX.detail.noClient}</Td>
                      <Td><StatusChip tone={BATCH_TONE[b.status]}>{a.status[b.status]}</StatusChip></Td>
                      <Td numeric className="whitespace-nowrap">
                        {c ? n(c.total) : '—'}
                        {pending > 0 ? <span className="block text-small text-warn-ink">{w.pending(n(pending))}</span> : null}
                      </Td>
                      <Td className="hidden text-small md:table-cell">{b.exports.length === 0 ? <span className="text-muted">{w.noExports}</span> : w.exportsCount(b.exports.length)}</Td>
                      <Td className="hidden whitespace-nowrap text-small lg:table-cell">{fmtDateTime(locale, b.createdAt)}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </Card>
          {pages > 1 ? (
            <nav className="mt-3 flex items-center justify-end gap-2 text-small" aria-label={w.page(page, pages)}>
              {page > 1 ? <ButtonLink href={withQuery('/onec', params, { page: String(page - 1) })} size="sm" variant="ghost">{w.prev}</ButtonLink> : null}
              <span className="tabular-nums text-muted">{w.page(page, pages)}</span>
              {page < pages ? <ButtonLink href={withQuery('/onec', params, { page: String(page + 1) })} size="sm" variant="ghost">{w.next}</ButtonLink> : null}
            </nav>
          ) : null}
        </>
      )}
    </Page>
  );
}
