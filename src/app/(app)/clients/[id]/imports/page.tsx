import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { canSeeClient, canWrite } from '@/lib/access';
import { ownedClient } from '@/lib/clients';
import { db } from '@/lib/db';
import { DOC_KINDS as KINDS, type DocKind } from '@/lib/docs';
import { formatTag, getI18n } from '@/lib/locale';
import { currentUser } from '@/lib/session';
import { StatusChip } from '@/ui/badge';
import { Page, Section } from '@/ui/page';
import { Table, Td, Th } from '@/ui/table';
import { Tabs } from '@/ui/tabs';
import { DeleteDocButton } from './delete-doc-button';
import { DocForm } from './doc-form';

export async function generateMetadata(): Promise<Metadata> {
  const { t, ta } = await getI18n();
  return { title: `${ta.docs.title} — ${t.appName}` };
}


const TONE = { uploaded: 'neutral', analyzing: 'brand', ready: 'good', failed: 'danger' } as const;

export default async function ImportsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ kind?: string }> }) {
  const { locale, t, ta } = await getI18n();
  const user = await currentUser();
  if (!user) redirect('/sign-in');
  const { id } = await params;
  const client = await ownedClient(user.orgId, id);
  if (!client || !canSeeClient(user, client.id)) notFound();
  const sp = await searchParams;
  const kind: DocKind = KINDS.find((k) => k === sp.kind) ?? 'cheques';
  const lists = await db.docList.findMany({ where: { orgId: user.orgId, clientId: client.id, kind }, orderBy: { createdAt: 'desc' }, take: 30 });

  return (
    <Page title={ta.docs.title} hint={ta.docs.kindHint[kind]} wide>
      <p className="-mt-3 mb-4 text-sm">
        <Link href="/clients" className="text-brand hover:underline">{t.clientsTitle}</Link><span className="mx-1.5 text-muted">/</span>
        <Link href={`/clients/${client.id}`} className="text-brand hover:underline">{client.name}</Link>
      </p>
      <Tabs items={KINDS.map((k) => ({ href: `/clients/${client.id}/imports?kind=${k}`, label: ta.docs.kinds[k], active: k === kind }))} />
      <div className="mt-5">{canWrite(user) && !user.demo ? <DocForm key={kind} clientId={client.id} kind={kind} /> : null}</div>

      <Section title={ta.docs.lists}>
        {lists.length === 0 ? <p className="text-sm text-muted">{ta.docs.none}</p> : (
          <Table>
            <thead><tr><Th>{t.catalogsFile}</Th><Th>{t.catalogsDate}</Th><Th className="text-right">{t.catalogsRows}</Th><Th>{t.catalogsStatus}</Th><Th><span className="sr-only">—</span></Th></tr></thead>
            <tbody>
              {lists.map((l) => (
                <tr key={l.id} className="hover:bg-surface/60">
                  <Td className="max-w-xs truncate font-medium"><Link href={`/clients/${client.id}/imports/${l.id}`} className="hover:text-brand">{l.filename}</Link></Td>
                  <Td className="whitespace-nowrap text-muted">{l.createdAt.toLocaleDateString(formatTag(locale))}</Td>
                  <Td className="text-right">{l.rowCount.toLocaleString(formatTag(locale))}</Td>
                  <Td><StatusChip tone={TONE[l.status as keyof typeof TONE] ?? 'neutral'}>{ta.docs.status[l.status as keyof typeof ta.docs.status] ?? l.status}</StatusChip></Td>
                  <Td><span className="flex justify-end gap-2"><Link href={`/clients/${client.id}/imports/${l.id}`} className="text-brand hover:underline">{ta.catalogs.open}</Link>{canWrite(user) ? <DeleteDocButton listId={l.id} /> : null}</span></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Section>
    </Page>
  );
}
