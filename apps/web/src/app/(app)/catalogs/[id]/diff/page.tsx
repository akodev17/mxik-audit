import { getI18n } from '@/lib/locale';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { catalogScope } from '@/lib/access';
import { db } from '@/lib/db';
import { fmtDate, fmtNumber } from '@/lib/format';
import { currentUser } from '@/lib/session';
import { compareCandidates, versionDiff, type CarriedRow, type DiffRow } from '@/lib/versions';
import { Badge, StatusChip } from '@/ui/badge';
import { Button, ButtonLink } from '@/ui/button';
import { CodeChip } from '@/ui/code-chip';
import { EmptyState } from '@/ui/empty-state';
import { typeLabels } from '@/ui/labels';
import { Page, Section } from '@/ui/page';
import { Select } from '@/ui/select';
import { Stat } from '@/ui/stat';
import { Table, Td, Th } from '@/ui/table';

export async function generateMetadata(): Promise<Metadata> {
  const { t, ta } = await getI18n();
  return { title: `${ta.diff.title} — ${t.appName}` };
}

const PAGE = 100;
type Kind = 'changed' | 'added' | 'removed' | 'status';
const KINDS: readonly Kind[] = ['changed', 'added', 'removed', 'status'];

/** The row in a catalogue's review workspace, found by its name (every state, so a decided row is found too). */
const rowHref = (catalogId: string, name: string): string => `/catalogs/${catalogId}?v=0&dec=all&q=${encodeURIComponent(name.slice(0, 100))}`;

/** Rows of a list; `what` adds the column of changed fields. Names link to the row in the workspace (removed rows: in the previous version). */
async function RowsTable({ rows, label, what, catalogId, previousId, removed = false }: { rows: DiffRow[]; label: string; what: boolean; catalogId: string; previousId: string; removed?: boolean }) {
  const { locale, t, ta } = await getI18n();
  const d = ta.importX.diff;
  const notes = d.notes;
  return (
    <Table label={label}>
      <thead><tr><Th numeric>#</Th><Th>{t.reviewProduct}</Th><Th>{ta.ws.colCurrent}</Th>{what ? <Th>{d.what}</Th> : null}</tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={`${r.rowIndex}|${r.name}`}>
            <Td numeric className="text-muted">{fmtNumber(locale, r.rowIndex + 1)}</Td>
            <Td className="max-w-md">
              <Link href={rowHref(removed ? previousId : catalogId, r.name)} title={d.openRow} className="block truncate font-medium hover:text-brand-ink hover:underline">{r.name}</Link>
              {r.unit ? <span className="text-small text-muted">{r.unit}</span> : null}
              {r.before && r.notes?.includes('name') ? <span className="block truncate text-small text-muted" title={r.before.name}>{d.before}: {r.before.name}</span> : null}
              {r.before && r.notes?.includes('unit') ? <span className="block text-small text-muted">{d.before}: {r.before.unit ?? '-'}</span> : null}
            </Td>
            <Td>
              {r.code ? <CodeChip code={r.code} /> : <span className="text-muted">{ta.ws.noCode}</span>}
              {r.before && r.notes?.includes('code') ? <span className="mt-1 block text-small text-muted">{d.before}: {r.before.code ? <CodeChip code={r.before.code} /> : ta.ws.noCode}</span> : null}
            </Td>
            {what ? (
              <Td>
                <span className="flex flex-wrap gap-1">
                  {r.notes?.map((n) => <Badge key={n} tone={n === 'nowRisky' ? 'danger' : n === 'nowSafe' ? 'good' : 'neutral'}>{notes[n]}</Badge>)}
                  {r.match === 'row' ? <span title={d.approxHint}><Badge tone="warn">{d.approx}</Badge></span> : null}
                </span>
              </Td>
            ) : null}
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

async function CarriedTable({ rows }: { rows: CarriedRow[] }) {
  const { locale, t, ta } = await getI18n();
  const d = ta.importX.diff;
  const types = typeLabels(t);
  return (
    <Table label={d.carried}>
      <thead><tr><Th numeric>#</Th><Th>{t.reviewProduct}</Th><Th>{d.decision}</Th><Th>{d.decidedBy}</Th></tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={`${r.rowIndex}|${r.type}`}>
            <Td numeric className="text-muted">{fmtNumber(locale, r.rowIndex + 1)}</Td>
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

/** No linked previous version: say so, and offer the client's other catalogues to compare with. */
async function NotLinked({ orgId, catalogId }: { orgId: string; catalogId: string }) {
  const { locale, ta } = await getI18n();
  const d = ta.importX.diff;
  const candidates = await compareCandidates(orgId, catalogId);
  const back = <ButtonLink href={`/catalogs/${catalogId}`} variant={candidates.length > 0 ? 'ghost' : 'primary'}>{d.backToWorkspace}</ButtonLink>;
  if (candidates.length === 0) return <EmptyState title={d.noOther} hint={d.noOtherHint} action={back} />;
  return (
    <EmptyState
      title={d.notLinked} hint={d.notLinkedHint}
      action={(
        <form method="get" action={`/catalogs/${catalogId}/diff`} className="flex w-full flex-col items-stretch gap-2 text-left sm:flex-row sm:items-end">
          <Select name="with" label={d.compareWith} wrapperClassName="min-w-0 flex-1" defaultValue={candidates[0]?.id}>
            {candidates.map((c) => <option key={c.id} value={c.id}>{`${c.filename} · ${fmtDate(locale, c.createdAt)}`}</option>)}
          </Select>
          <Button type="submit" variant="primary">{d.compare}</Button>
          {back}
        </form>
      )}
    />
  );
}

export default async function DiffPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ with?: string; show?: string; page?: string }> }) {
  const { locale, t, ta } = await getI18n();
  const d = ta.importX.diff;
  const n = (v: number): string => fmtNumber(locale, v);
  const user = await currentUser();
  if (!user) redirect('/sign-in');
  const { id } = await params;
  const sp = await searchParams;
  const against = sp.with;
  const show = KINDS.find((k) => k === sp.show) ?? null;
  const page = Math.max(0, Number.parseInt(sp.page ?? '1', 10) - 1 || 0);
  const window = show ? { limit: PAGE, offset: page * PAGE } : {};
  const catalog = await db.catalog.findFirst({ where: { id, ...catalogScope(user) }, select: { id: true, filename: true } });
  if (!catalog) notFound();
  const crumbs = [{ label: t.navCatalogs, href: '/catalogs' }, { label: catalog.filename, href: `/catalogs/${catalog.id}` }];
  // A chosen catalogue that is not the client's (or not ready) falls back to the linked version.
  const chosen = typeof against === 'string' && against ? await versionDiff(user.orgId, catalog.id, against, window) : null;
  const diff = chosen ?? await versionDiff(user.orgId, catalog.id, undefined, window);

  if (!diff) {
    return <Page title={ta.diff.title} crumbs={crumbs}><NotLinked orgId={user.orgId} catalogId={catalog.id} /></Page>;
  }
  const c = diff.counts;
  const workspace = `/catalogs/${catalog.id}`;
  const lists: [string, string, number, DiffRow[], boolean][] = [
    ['changed', ta.diff.changed, c.changed, diff.changed, true],
    ['added', ta.diff.added, c.added, diff.added, false],
    ['removed', ta.diff.removed, c.removed, diff.removed, false],
    ['status', ta.diff.statusChanged, c.statusChanged, diff.statusChanged, true],
  ];

  return (
    <Page
      title={ta.diff.title} hint={diff.linked ? ta.diff.hint : d.chosenHint} wide crumbs={crumbs}
      actions={(
        <>
          <ButtonLink href={`/api/catalog-diff?catalog=${catalog.id}${against ? `&with=${encodeURIComponent(against)}` : ''}`} variant="secondary" download>{d.exportCsv}</ButtonLink>
          <ButtonLink href={`/catalogs/${diff.previousId}`} variant="ghost">{diff.linked ? ta.diff.openPrevious : d.openChosen}</ButtonLink>
        </>
      )}
    >
      <p className="-mt-2 mb-4 text-small text-muted">{d.comparedWith(diff.previous.filename, fmtDate(locale, diff.previous.createdAt))}</p>
      {/* Three across at most: the labels are long in both languages and must not be cut. */}
      <div className="mb-8 grid gap-3 sm:grid-cols-2 md:grid-cols-3">
        <Stat label={ta.diff.added} value={n(c.added)} href={c.added > 0 ? '#added' : undefined} />
        <Stat label={ta.diff.removed} value={n(c.removed)} href={c.removed > 0 ? '#removed' : undefined} />
        <Stat label={ta.diff.changed} value={n(c.changed)} href={c.changed > 0 ? '#changed' : undefined} />
        <Stat label={d.unchanged} value={n(c.unchanged)} />
        {diff.linked ? <Stat label={d.carried} value={n(c.carried)} tone={c.carried > 0 ? 'good' : 'neutral'} href={c.carried > 0 ? '#carried' : undefined} /> : null}
        <Stat label={d.reReview} value={n(c.reReview)} tone={c.reReview > 0 ? 'warn' : 'neutral'} href={c.reReview > 0 ? '#rereview' : undefined} />
      </div>

      <nav aria-label={d.filterLabel} className="-mt-3 mb-8 flex flex-wrap items-center gap-1 text-small">
        {([null, ...KINDS] as const).map((k) => {
          const count = k === null ? null : k === 'status' ? c.statusChanged : c[k];
          const label = k === null ? d.showAll : k === 'status' ? ta.diff.statusChanged : ta.diff[k];
          const href = `/catalogs/${catalog.id}/diff?${new URLSearchParams({ ...(against ? { with: against } : {}), ...(k ? { show: k } : {}) }).toString()}`;
          return (
            <Link
              key={k ?? 'all'} href={href} aria-current={k === show ? 'true' : undefined}
              className={`rounded-ctl px-2.5 py-1 font-medium transition-colors duration-(--duration-fast) ${k === show ? 'bg-surface text-fg' : 'text-muted hover:bg-surface hover:text-fg'}`}
            >
              {label}{count !== null ? <> <span className="tabular-nums text-subtle">{n(count)}</span></> : null}
            </Link>
          );
        })}
      </nav>

      {show ? (() => {
        const list = lists.find(([key]) => key === show);
        if (!list) return null;
        const [key, label, count, rows, what] = list;
        const pages = Math.max(1, Math.ceil(count / PAGE));
        const at = (p: number): string => `/catalogs/${catalog.id}/diff?${new URLSearchParams({ ...(against ? { with: against } : {}), show, page: String(p + 1) }).toString()}`;
        return (
          <Section title={`${label} (${n(count)})`}>
            {rows.length === 0 ? <EmptyState size="compact" title={d.showAll} /> : <RowsTable rows={rows} label={label} what={what} catalogId={catalog.id} previousId={diff.previousId} removed={key === 'removed'} />}
            {pages > 1 ? (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-small text-muted">
                <span className="tabular-nums">{d.pageOf(page + 1, pages)}</span>
                <span className="flex gap-2">
                  {page > 0 ? <ButtonLink href={at(page - 1)} size="sm">{d.prevPage}</ButtonLink> : null}
                  {page < pages - 1 ? <ButtonLink href={at(page + 1)} size="sm">{d.nextPage}</ButtonLink> : null}
                </span>
              </div>
            ) : null}
          </Section>
        );
      })() : (
      <div className="space-y-10">
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
              <RowsTable rows={diff.reReview} label={d.reReview} what catalogId={catalog.id} previousId={diff.previousId} />
              {c.reReview > diff.reReview.length ? <p className="mt-2 text-small text-muted">{ta.diff.firstOnly(diff.reReview.length)}</p> : null}
            </Section>
          </div>
        ) : null}

        {lists.map(([key, label, count, rows, what]) => (count === 0 ? null : (
          <div key={key} id={key} className="scroll-mt-4">
            <Section title={`${label} (${n(count)})`}>
              <RowsTable rows={rows} label={label} what={what} catalogId={catalog.id} previousId={diff.previousId} removed={key === 'removed'} />
              {count > rows.length ? <p className="mt-2 text-small text-muted">{ta.diff.firstOnly(rows.length)}</p> : null}
            </Section>
          </div>
        )))}
      </div>
      )}
    </Page>
  );
}
