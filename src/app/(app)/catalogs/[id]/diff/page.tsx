import { getI18n } from '@/lib/locale';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { catalogScope } from '@/lib/access';
import { db } from '@/lib/db';
import { fmtDate, fmtNumber } from '@/lib/format';
import { currentUser } from '@/lib/session';
import { versionDiff, type CarriedRow, type DiffRow } from '@/lib/versions';
import { Badge, StatusChip } from '@/ui/badge';
import { ButtonLink } from '@/ui/button';
import { CodeChip } from '@/ui/code-chip';
import { EmptyState } from '@/ui/empty-state';
import { typeLabels } from '@/ui/labels';
import { Page, Section } from '@/ui/page';
import { Stat } from '@/ui/stat';
import { Table, Td, Th } from '@/ui/table';

export async function generateMetadata(): Promise<Metadata> {
  const { t, ta } = await getI18n();
  return { title: `${ta.diff.title} — ${t.appName}` };
}

async function RowsTable({ rows, label }: { rows: DiffRow[]; label: string }) {
  const { t, ta } = await getI18n();
  const notes = ta.importX.diff.notes;
  return (
    <Table label={label}>
      <thead><tr><Th numeric>#</Th><Th>{t.reviewProduct}</Th><Th>{ta.ws.colCurrent}</Th><Th>{ta.importX.diff.what}</Th></tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={`${r.rowIndex}|${r.name}`}>
            <Td numeric className="text-muted">{r.rowIndex + 1}</Td>
            <Td className="max-w-md"><span className="block truncate font-medium" title={r.name}>{r.name}</span>{r.unit ? <span className="text-small text-muted">{r.unit}</span> : null}</Td>
            <Td>{r.code ? <CodeChip code={r.code} /> : <span className="text-muted">{ta.ws.noCode}</span>}</Td>
            <Td><span className="flex flex-wrap gap-1">{r.notes?.map((n) => <Badge key={n} tone={n === 'nowRisky' ? 'danger' : n === 'nowSafe' ? 'good' : 'neutral'}>{notes[n]}</Badge>)}</span></Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

async function CarriedTable({ rows }: { rows: CarriedRow[] }) {
  const { t, ta } = await getI18n();
  const d = ta.importX.diff;
  const types = typeLabels(t);
  return (
    <Table label={d.carried}>
      <thead><tr><Th numeric>#</Th><Th>{t.reviewProduct}</Th><Th>{d.decision}</Th><Th>{d.decidedBy}</Th></tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={`${r.rowIndex}|${r.type}`}>
            <Td numeric className="text-muted">{r.rowIndex + 1}</Td>
            <Td className="max-w-md"><span className="block truncate font-medium" title={r.name}>{r.name}</span><span className="text-small text-muted">{types[r.type] ?? r.type}</span></Td>
            <Td>
              <span className="flex flex-wrap items-center gap-2">
                <StatusChip tone={r.decision === 'accepted' ? 'good' : 'neutral'}>{d.decisions[r.decision]}</StatusChip>
                {r.decision === 'accepted' && r.code ? <CodeChip code={r.code} /> : null}
              </span>
            </Td>
            <Td>
              <span className="flex flex-wrap items-center gap-2">
                <span className="text-data">{r.decidedBy ?? d.unknownUser}</span>
                <Badge tone="brand">{d.fromPrevious}</Badge>
              </span>
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

export default async function DiffPage({ params }: { params: Promise<{ id: string }> }) {
  const { locale, t, ta } = await getI18n();
  const d = ta.importX.diff;
  const n = (v: number): string => fmtNumber(locale, v);
  const user = await currentUser();
  if (!user) redirect('/sign-in');
  const { id } = await params;
  const catalog = await db.catalog.findFirst({ where: { id, ...catalogScope(user) }, select: { id: true, filename: true } });
  if (!catalog) notFound();
  const crumbs = [{ label: t.navCatalogs, href: '/catalogs' }, { label: catalog.filename, href: `/catalogs/${catalog.id}` }];
  const diff = await versionDiff(user.orgId, catalog.id);

  if (!diff) {
    return <Page title={ta.diff.title} crumbs={crumbs}><EmptyState title={ta.diff.none} hint={ta.diff.noneHint} /></Page>;
  }
  const c = diff.counts;
  const workspace = `/catalogs/${catalog.id}`;
  const lists: [string, string, number, DiffRow[]][] = [
    ['changed', ta.diff.changed, c.changed, diff.changed],
    ['added', ta.diff.added, c.added, diff.added],
    ['removed', ta.diff.removed, c.removed, diff.removed],
    ['status', ta.diff.statusChanged, c.statusChanged, diff.statusChanged],
  ];

  return (
    <Page
      title={ta.diff.title} hint={ta.diff.hint} wide crumbs={crumbs}
      actions={<ButtonLink href={`/catalogs/${diff.previousId}`} variant="ghost">{ta.diff.openPrevious}</ButtonLink>}
    >
      <p className="-mt-2 mb-4 text-small text-muted">{d.comparedWith(diff.previous.filename, fmtDate(locale, diff.previous.createdAt))}</p>
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label={ta.diff.added} value={n(c.added)} href={c.added > 0 ? '#added' : undefined} />
        <Stat label={ta.diff.removed} value={n(c.removed)} href={c.removed > 0 ? '#removed' : undefined} />
        <Stat label={ta.diff.changed} value={n(c.changed)} href={c.changed > 0 ? '#changed' : undefined} />
        <Stat label={d.unchanged} value={n(c.unchanged)} />
        <Stat label={d.carried} value={n(c.carried)} tone={c.carried > 0 ? 'good' : 'neutral'} href={c.carried > 0 ? '#carried' : undefined} />
        <Stat label={d.reReview} value={n(c.reReview)} tone={c.reReview > 0 ? 'warn' : 'neutral'} href={c.reReview > 0 ? '#rereview' : undefined} />
      </div>

      {c.carried > 0 ? (
        <div id="carried" className="scroll-mt-4">
          <Section
            title={`${d.carried} (${n(c.carried)})`} hint={d.carriedHint}
            actions={<ButtonLink href={`${workspace}?pending=0&source=carry_over`} size="sm">{d.openCarried}</ButtonLink>}
          >
            <CarriedTable rows={diff.carried} />
            {c.carried > diff.carried.length ? <p className="mt-2 text-small text-muted">{ta.diff.firstOnly(diff.carried.length)}</p> : null}
          </Section>
        </div>
      ) : null}

      {c.reReview > 0 ? (
        <div id="rereview" className="scroll-mt-4">
          <Section
            title={`${d.reReview} (${n(c.reReview)})`} hint={d.reReviewHint}
            actions={<ButtonLink href={workspace} size="sm">{d.openReview}</ButtonLink>}
          >
            <RowsTable rows={diff.reReview} label={d.reReview} />
            {c.reReview > diff.reReview.length ? <p className="mt-2 text-small text-muted">{ta.diff.firstOnly(diff.reReview.length)}</p> : null}
          </Section>
        </div>
      ) : null}

      {lists.map(([key, label, count, rows]) => (count === 0 ? null : (
        <div key={key} id={key} className="scroll-mt-4">
          <Section title={`${label} (${n(count)})`}>
            <RowsTable rows={rows} label={label} />
            {count > rows.length ? <p className="mt-2 text-small text-muted">{ta.diff.firstOnly(rows.length)}</p> : null}
          </Section>
        </div>
      )))}
    </Page>
  );
}
