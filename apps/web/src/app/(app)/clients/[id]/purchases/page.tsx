import type { Metadata } from 'next';
import { getI18n } from '@/lib/locale';
import { canWrite } from '@/lib/pure/access';
import { fmtDate, fmtNumber } from '@tasnivo/i18n/format';
import { pageData } from '@/lib/api/page-data';
import { serverApi } from '@/lib/api/server';
import { StatusChip, StatusIcon } from '@/ui/badge';
import { ButtonLink } from '@/ui/button';
import { EmptyState } from '@/ui/empty-state';
import { Page } from '@/ui/page';
import { Table, Td, Th } from '@/ui/table';
import { Card, FLUSH_TABLE } from '../../../_manage/card';
import { ListFlow } from '../../../_manage/list-flow';
import { Notice } from '../../../_manage/notice';
import { DeleteListButton } from './delete-button';
import { PurchaseForm, PurchaseMapper } from './purchase-form';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: `${t.purchasesTitle} — ${t.appName}` };
}

export default async function PurchasesPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ map?: string }> }) {
  const { locale, t, ta } = await getI18n();
  const { id } = await params;
  const sp = await searchParams;
  const api = serverApi();
  // Each list carries its mapping (stored or guessed) and first rows, so "columns not chosen" resumes from it.
  const [user, { client, lists }] = await Promise.all([pageData(api.auth.me()), pageData(api.imports.purchases({ clientId: id }))]);
  const writable = canWrite(user) && !user.demo;

  const resuming = writable ? lists.find((l) => l.id === sp.map && l.status === 'uploaded') : undefined;
  const n = (v: number): string => fmtNumber(locale, v);

  return (
    <Page title={t.purchasesTitle} hint={t.purchasesHint} wide crumbs={[{ label: t.clientsTitle, href: '/clients' }, { label: client.name, href: `/clients/${client.id}` }]}>
      <div className="space-y-6">
        {!writable ? <Notice tone="info">{ta.importX.lists.readOnly}</Notice> : resuming ? (
          <ListFlow step={1}>
            <PurchaseMapper
              listId={resuming.id} filename={resuming.filename} headers={resuming.headers} rows={resuming.sample} map={resuming.map}
              notes={resuming.truncated ? <Notice tone="danger">{ta.importX.lists.truncated(resuming.rowCount, resuming.totalSeen ?? resuming.rowCount)}</Notice> : undefined}
            />
          </ListFlow>
        ) : <PurchaseForm clientId={client.id} />}

        <Card title={t.purchasesLists} flush={lists.length > 0}>
          {lists.length === 0 ? (
            <EmptyState size="compact" as="h3" title={t.purchasesNone} />
          ) : (
            <Table label={t.purchasesLists} className={FLUSH_TABLE}>
              <thead>
                <tr>
                  <Th>{t.catalogsFile}</Th>
                  <Th>{t.catalogsDate}</Th>
                  <Th numeric>{t.catalogsRows}</Th>
                  <Th numeric>{ta.mgX.clients.colCodes}</Th>
                  <Th>{t.catalogsStatus}</Th>
                  <Th><span className="sr-only">{ta.mgX.actions}</span></Th>
                </tr>
              </thead>
              <tbody>
                {lists.map((l) => {
                  const tone = l.status === 'ready' ? 'good' : 'warn';
                  return (
                    <tr key={l.id} className="hover:bg-surface">
                      <Td className="max-w-xs"><span className="block truncate font-medium" title={l.filename}>{l.filename}</span></Td>
                      <Td className="whitespace-nowrap text-muted">{fmtDate(locale, l.createdAt)}</Td>
                      <Td numeric>{n(l.rowCount)}</Td>
                      <Td numeric>{n(l.codes)}</Td>
                      <Td><StatusChip tone={tone} icon={<StatusIcon tone={tone} size={12} />}>{t.purchasesStatus[l.status] ?? l.status}</StatusChip></Td>
                      <Td>
                        <span className="flex justify-end gap-2">
                          {writable && l.status === 'uploaded' ? <ButtonLink href={`/clients/${client.id}/purchases?map=${l.id}`} size="sm">{ta.importX.lists.resume}</ButtonLink> : null}
                          {writable ? <DeleteListButton listId={l.id} kind="purchases" scope={`${client.name} · ${l.filename}`} rows={l.rowCount} /> : null}
                        </span>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    </Page>
  );
}
