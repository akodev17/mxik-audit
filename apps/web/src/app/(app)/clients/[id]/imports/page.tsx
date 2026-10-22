import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { DeleteListButton } from '@/app/(app)/clients/[id]/purchases/delete-button';
import { Notice } from '@/app/(app)/upload/notice';
import { canSeeClient, canWrite } from '@tasnivo/domain/access';
import { StoredAttrs } from '@tasnivo/domain/catalog-import';
import { ownedClient } from '@tasnivo/domain/clients';
import { db } from '@tasnivo/db';
import { DOC_KINDS as KINDS, DocMapSchema, docCheckStale, guessDocMap, readDocMeta, type DocKind } from '@tasnivo/domain/docs';
import { fmtDate, fmtNumber } from '@tasnivo/i18n/format';
import { getI18n } from '@/lib/locale';
import { SAMPLE_ROWS } from '@tasnivo/domain/purchases';
import { currentUser } from '@/lib/session';
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

async function sampleRows(listId: string, meta: unknown): Promise<string[][]> {
  const stored = readDocMeta(meta).sample;
  if (stored) return stored;
  const items = await db.docItem.findMany({ where: { listId }, orderBy: { rowIndex: 'asc' }, take: SAMPLE_ROWS, select: { attrs: true } });
  return items.map((i) => StoredAttrs.safeParse(i.attrs).data?.original ?? []);
}

export default async function ImportsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ kind?: string; map?: string }> }) {
  const { locale, t, ta } = await getI18n();
  const user = await currentUser();
  if (!user) redirect('/sign-in');
  const { id } = await params;
  const client = await ownedClient(user.orgId, id);
  if (!client || !canSeeClient(user, client.id)) notFound();
  const sp = await searchParams;
  const kind: DocKind = KINDS.find((k) => k === sp.kind) ?? 'cheques';
  const writable = canWrite(user) && !user.demo;
  const lists = await db.docList.findMany({ where: { orgId: user.orgId, clientId: client.id, kind }, orderBy: { createdAt: 'desc' }, take: 30 });
  const resuming = writable ? lists.find((l) => l.id === sp.map && (l.status === 'uploaded' || l.status === 'failed')) : undefined;
  const resumeRows = resuming ? await sampleRows(resuming.id, resuming.meta) : [];
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
            clientId={client.id} kind={kind} listId={resuming.id} filename={resuming.filename} headers={resuming.headers} rows={resumeRows}
            map={DocMapSchema.safeParse(resuming.columnMap).data ?? guessDocMap(resuming.headers)}
            notes={readDocMeta(resuming.meta).truncated ? <Notice tone="danger">{ta.importX.lists.truncated(resuming.rowCount, readDocMeta(resuming.meta).totalSeen ?? resuming.rowCount)}</Notice> : undefined}
          />
        </div>
      ) : null}

      <Section title={ta.docs.lists}>
        {lists.length === 0 ? <EmptyState size="compact" as="h3" title={ta.docs.none} /> : (
          <Table label={ta.docs.lists}>
            <thead><tr><Th>{t.catalogsFile}</Th><Th>{t.catalogsStatus}</Th><Th numeric>{t.catalogsRows}</Th><Th>{t.catalogsDate}</Th><Th><span className="sr-only">{ta.importX.lists.delete}</span></Th></tr></thead>
            <tbody>
              {lists.map((l) => {
                const stale = docCheckStale(l);
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
