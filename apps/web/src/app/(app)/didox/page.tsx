// Didox incoming invoices: upload or fetch, then the list of invoices with seller, date, totals,
// status and line counts. The client filter is the shell's (?client=, CLIENT_LISTS).
import type { Metadata } from 'next';
import Link from 'next/link';
import { fmtDate, fmtNumber } from '@tasnivo/i18n/format';
import { pageData } from '@/lib/api/page-data';
import { serverApi } from '@/lib/api/server';
import { getI18n } from '@/lib/locale';
import { canWrite, isAdminRole } from '@/lib/pure/access';
import { Alert } from '@/ui/alert';
import { StatusChip, StatusIcon } from '@/ui/badge';
import { ButtonLink } from '@/ui/button';
import { EmptyState } from '@/ui/empty-state';
import { IconGear } from '@/ui/icons';
import { Page } from '@/ui/page';
import { Table, Td, Th } from '@/ui/table';
import { Card, FLUSH_TABLE } from '../_manage/card';
import { DeleteInvoiceButton } from './delete-button';
import { DidoxIntake } from './intake';
import { batchTone, decimalText } from './model';

export async function generateMetadata(): Promise<Metadata> {
  const { t, ta } = await getI18n();
  return { title: `${ta.didoxX.title} — ${t.appName}` };
}

type Params = { client?: string; page?: string };

export default async function DidoxPage({ searchParams }: { searchParams: Promise<Params> }) {
  const { locale, ta } = await getI18n();
  const d = ta.didoxX;
  const a = ta.accountingX;
  const sp = await searchParams;
  const clientId = sp.client && sp.client !== 'all' ? sp.client : undefined;
  const page = Math.max(0, Number(sp.page ?? 1) - 1) || 0;
  const api = serverApi();
  const [user, list, options] = await Promise.all([
    pageData(api.auth.me()),
    pageData(api.didox.list({ ...(clientId ? { clientId } : {}), page })),
    pageData(api.catalogs.uploadOptions()),
  ]);
  const writable = canWrite(user) && !user.demo;
  const admin = isAdminRole(user);
  const n = (v: number): string => fmtNumber(locale, v);

  return (
    <Page
      title={d.title} hint={d.hint} wide
      actions={admin ? <ButtonLink href="/didox/settings" variant="secondary" leadingIcon={<IconGear size={16} />}>{d.nav.settings}</ButtonLink> : null}
    >
      <div className="space-y-6">
        <Alert tone="info">{d.unverified}</Alert>
        <DidoxIntake
          clients={options.clients} clientId={clientId ?? null} connected={list.connection.connected}
          lastSync={list.connection.lastSyncAt} writable={writable} admin={admin}
        />
        <Card title={d.nav.invoices} flush={list.rows.length > 0}>
          {list.rows.length === 0 ? (
            <EmptyState size="compact" as="h3" title={d.list.emptyTitle} hint={d.list.emptyHint} />
          ) : (
            <Table label={d.nav.invoices} className={FLUSH_TABLE}>
              <thead>
                <tr>
                  <Th>{d.list.seller}</Th>
                  <Th>{d.list.number}</Th>
                  <Th>{d.list.date}</Th>
                  <Th numeric>{d.list.total}</Th>
                  <Th numeric>{d.list.lines}</Th>
                  <Th numeric>{d.list.issues}</Th>
                  <Th>{d.list.status}</Th>
                  <Th className="hidden xl:table-cell">{d.list.source}</Th>
                  <Th><span className="sr-only">{d.list.remove}</span></Th>
                </tr>
              </thead>
              <tbody>
                {list.rows.map((r) => {
                  const tone = batchTone(r.status);
                  return (
                    <tr key={r.id} className="hover:bg-surface">
                      <Td className="max-w-xs">
                        <Link href={`/didox/${r.id}`} className="block truncate font-medium text-ink underline-offset-2 hover:underline" title={r.sellerName}>{r.sellerName || '—'}</Link>
                        <span className="block truncate text-small text-muted">{[r.sellerInn, r.clientName].filter(Boolean).join(' · ')}</span>
                      </Td>
                      <Td className="whitespace-nowrap">{r.number}</Td>
                      <Td className="whitespace-nowrap text-muted">{r.date ? fmtDate(locale, r.date) : '—'}</Td>
                      <Td numeric className="whitespace-nowrap">{decimalText(r.totalWithVat, { money: true })}</Td>
                      <Td numeric>{n(r.counts?.total ?? 0)}</Td>
                      <Td numeric className={r.issues > 0 ? 'text-warn-ink' : 'text-muted'}>{n(r.issues)}</Td>
                      <Td><StatusChip tone={tone} icon={<StatusIcon tone={tone} size={12} />}>{a.status[r.status as keyof typeof a.status] ?? r.status}</StatusChip></Td>
                      <Td className="hidden whitespace-nowrap text-muted xl:table-cell">{d.list.sources[r.source] ?? r.source}</Td>
                      <Td>
                        <span className="flex justify-end">
                          {writable ? <DeleteInvoiceButton batchId={r.id} label={`${r.sellerName} · ${r.number}`} lines={r.counts?.total ?? 0} /> : null}
                        </span>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Card>
        {list.total > list.pageSize ? (
          <nav className="flex justify-end gap-2" aria-label={d.nav.invoices}>
            {page > 0 ? <ButtonLink size="sm" href={`/didox?page=${page}${clientId ? `&client=${clientId}` : ''}`}>←</ButtonLink> : null}
            {(page + 1) * list.pageSize < list.total ? <ButtonLink size="sm" href={`/didox?page=${page + 2}${clientId ? `&client=${clientId}` : ''}`}>→</ButtonLink> : null}
          </nav>
        ) : null}
      </div>
    </Page>
  );
}
