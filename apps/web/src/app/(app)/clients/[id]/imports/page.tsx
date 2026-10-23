import type { Metadata } from 'next';
import Link from 'next/link';
import { DOC_KINDS as KINDS, type endpoints, type ResponseOf } from '@tasnivo/contracts';
import { DeleteListButton } from '@/app/(app)/clients/[id]/purchases/delete-button';
import { Notice } from '@/app/(app)/upload/notice';
import { canWrite } from '@/lib/pure/access';
import type { DocKind } from '@/lib/pure/types';
import { fmtDate, fmtNumber } from '@tasnivo/i18n/format';
import { pageData } from '@/lib/api/page-data';
import { serverApi } from '@/lib/api/server';
import { getI18n } from '@/lib/locale';
import { StatusChip } from '@/ui/badge';
import { ButtonLink } from '@/ui/button';
import { EmptyState } from '@/ui/empty-state';
import { Page, Section } from '@/ui/page';
import { Table, Td, Th } from '@/ui/table';
import { Tabs } from '@/ui/tabs';
import { DocForm, DocMapper } from './doc-form';

export async function generateMetadata(): Promise<Metadata> {
  const { t, ta } = await getI18n();
  return { title: `${ta.docs.title} — ${t.appName}` };
}

const TONE = { uploaded: 'warn', analyzing: 'info', ready: 'good', failed: 'danger' } as const;

type DocListRow = ResponseOf<typeof endpoints.imports.docs>['lists'][number];

export default async function ImportsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ kind?: string; map?: string }> }) {
  const { locale, t, ta } = await getI18n();
  const { id } = await params;
  const sp = await searchParams;
  const kind: DocKind = KINDS.find((k) => k === sp.kind) ?? 'cheques';
  const api = serverApi();
  const [user, { client, lists }] = await Promise.all([pageData(api.auth.me()), pageData(api.imports.docs({ clientId: id, kind }))]);
  const writable = canWrite(user) && !user.demo;
  const resuming: DocListRow | undefined = writable ? lists.find((l) => l.id === sp.map && (l.status === 'uploaded' || l.status === 'failed')) : undefined;
  const n = (v: number): string => fmtNumber(locale, v);

  return (
    <Page title={ta.docs.title} hint={ta.docs.kindHint[kind]} wide crumbs={[{ label: t.clientsTitle, href: '/clients' }, { label: client.name, href: `/clients/${client.id}` }]}>
      <Tabs items={KINDS.map((k) => ({ href: `/clients/${client.id}/imports?kind=${k}`, label: ta.docs.kinds[k], active: k === kind }))} />
      <div className="mt-5">
        {writable ? <DocForm key={kind} clientId={client.id} kind={kind} /> : <Notice tone="info">{ta.importX.lists.readOnly}</Notice>}
      </div>

      {resuming ? (
        <div className="mt-4">
          <DocMapper
            clientId={client.id} kind={kind} listId={resuming.id} filename={resuming.filename} headers={resuming.headers} rows={resuming.sample}
            map={resuming.map}
            notes={resuming.truncated ? <Notice tone="danger">{ta.importX.lists.truncated(resuming.rowCount, resuming.totalSeen ?? resuming.rowCount)}</Notice> : undefined}
          />
        </div>
      ) : null}

      <Section title={ta.docs.lists}>
        {lists.length === 0 ? <EmptyState size="compact" as="h3" title={ta.docs.none} /> : (
          <Table label={ta.docs.lists}>
            <thead><tr><Th>{t.catalogsFile}</Th><Th>{t.catalogsStatus}</Th><Th numeric>{t.catalogsRows}</Th><Th>{t.catalogsDate}</Th><Th><span className="sr-only">{ta.importX.lists.delete}</span></Th></tr></thead>
            <tbody>
              {lists.map((l) => {
                const stale = l.stale;
                return (
                  <tr key={l.id}>
                    <Td className="max-w-xs"><Link href={`/clients/${client.id}/imports/${l.id}`} className="block truncate font-medium text-brand-ink hover:underline">{l.filename}</Link></Td>
                    <Td>
                      <StatusChip tone={stale ? 'warn' : TONE[l.status as keyof typeof TONE] ?? 'neutral'}>
                        {stale ? ta.importX.docs.stalled : ta.docs.status[l.status as keyof typeof ta.docs.status] ?? l.status}
                      </StatusChip>
                    </Td>
                    <Td numeric>{n(l.rowCount)}</Td>
                    <Td className="whitespace-nowrap text-muted">{fmtDate(locale, l.createdAt)}</Td>
                    <Td>
                      <span className="flex justify-end gap-2">
                        {writable && l.status === 'uploaded' ? <ButtonLink href={`/clients/${client.id}/imports?kind=${kind}&map=${l.id}`} size="sm">{ta.importX.lists.resume}</ButtonLink> : null}
                        {writable ? <DeleteListButton listId={l.id} kind="docs" scope={`${client.name} · ${l.filename}`} rows={l.rowCount} /> : null}
                      </span>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Section>
    </Page>
  );
}
