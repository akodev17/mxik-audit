import { getI18n } from '@/lib/locale';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { catalogScope } from '@/lib/access';
import { db } from '@/lib/db';
import { currentUser } from '@/lib/session';
import { versionDiff, type DiffRow } from '@/lib/versions';
import { Badge } from '@/ui/badge';
import { CodeChip } from '@/ui/code-chip';
import { EmptyState } from '@/ui/empty-state';
import { Page, Section } from '@/ui/page';
import { Table, Td, Th } from '@/ui/table';

export async function generateMetadata(): Promise<Metadata> {
  const { t, ta } = await getI18n();
  return { title: `${ta.diff.title} — ${t.appName}` };
}

async function RowsTable({ rows }: { rows: DiffRow[] }) {
  const { t, ta } = await getI18n();
  return (
    <Table>
      <thead><tr><Th>#</Th><Th>{t.reviewProduct}</Th><Th>{ta.ws.colCurrent}</Th><Th>{ta.diff.note}</Th></tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={`${r.rowIndex}|${r.name}`}>
            <Td className="text-muted">{r.rowIndex + 1}</Td>
            <Td className="max-w-md truncate font-medium" title={r.name}>{r.name}{r.unit ? <span className="ml-2 text-xs text-muted">{r.unit}</span> : null}</Td>
            <Td>{r.code ? <CodeChip code={r.code} /> : <span className="text-muted">{ta.ws.noCode}</span>}</Td>
            <Td>{r.notes ? r.notes.map((n) => <Badge key={n} className="mr-1">{ta.msg.diffNotes[n]}</Badge>) : null}</Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

export default async function DiffPage({ params }: { params: Promise<{ id: string }> }) {
  const { ta } = await getI18n();
  const user = await currentUser();
  if (!user) redirect('/sign-in');
  const { id } = await params;
  const catalog = await db.catalog.findFirst({ where: { id, ...catalogScope(user) }, select: { id: true, filename: true, previousId: true } });
  if (!catalog) notFound();
  const diff = await versionDiff(user.orgId, catalog.id);
  const back = <Link href={`/catalogs/${catalog.id}`} className="text-sm text-brand hover:underline">← {catalog.filename}</Link>;

  if (!diff) {
    return <Page title={ta.diff.title}>{back}<EmptyState title={ta.diff.none} hint={ta.diff.noneHint} /></Page>;
  }
  const sections: [string, number, DiffRow[]][] = [
    [ta.diff.added, diff.counts.added, diff.added],
    [ta.diff.removed, diff.counts.removed, diff.removed],
    [ta.diff.changed, diff.counts.changed, diff.changed],
    [ta.diff.statusChanged, diff.counts.statusChanged, diff.statusChanged],
  ];
  return (
    <Page title={ta.diff.title} hint={ta.diff.hint} wide actions={<Link href={`/catalogs/${diff.previousId}`} className="text-sm text-brand hover:underline">{ta.diff.openPrevious}</Link>}>
      <div className="-mt-3 mb-5">{back}</div>
      <dl className="mb-6 flex flex-wrap gap-6">
        {sections.map(([label, n]) => (
          <div key={label}><dt className="text-xs text-muted">{label}</dt><dd className="text-xl font-bold">{n.toLocaleString('uz-UZ')}</dd></div>
        ))}
      </dl>
      {sections.map(([label, n, rows]) => (n === 0 ? null : (
        <Section key={label} title={`${label} (${n.toLocaleString('uz-UZ')})`}>
          <RowsTable rows={rows} />
          {n > rows.length ? <p className="mt-2 text-xs text-muted">{ta.diff.firstOnly(rows.length)}</p> : null}
        </Section>
      )))}
    </Page>
  );
}
