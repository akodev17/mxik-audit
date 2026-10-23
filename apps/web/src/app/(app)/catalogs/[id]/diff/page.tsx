import { getI18n } from '@/lib/locale';
import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { fmtDate, fmtNumber } from '@tasnivo/i18n/format';
import { api } from '@/lib/api/browser';
import { serverApi } from '@/lib/api/server';
import { catalogHeader, orNotFound, signedInUser } from '@/lib/catalogs/server';
import type { CarriedRow, DiffRow } from '@/lib/catalogs/types';
import { Badge, StatusChip } from '@/ui/badge';
import { Button, ButtonLink } from '@/ui/button';
import { CodeChip } from '@/ui/code-chip';
import { cx } from '@/ui/cx';
import { EmptyState } from '@/ui/empty-state';
import { IconDownload } from '@/ui/icons';
import { typeLabels } from '@/ui/labels';
import { Page, Section } from '@/ui/page';
import { Select } from '@/ui/select';
import { Stat } from '@/ui/stat';
import { Table, Td, Th } from '@/ui/table';
import { Tabs } from '@/ui/tabs';

export async function generateMetadata(): Promise<Metadata> {
  const { t, ta } = await getI18n();
  return { title: `${ta.diff.title} — ${t.appName}` };
}

const PAGE = 100;
type Kind = 'changed' | 'added' | 'removed' | 'status';
const KINDS: readonly Kind[] = ['changed', 'added', 'removed', 'status'];

/** The row in a catalogue's review workspace, found by its name (every state, so a decided row is found too). */
const rowHref = (catalogId: string, name: string): string => `/catalogs/${catalogId}?v=0&dec=all&q=${encodeURIComponent(name.slice(0, 100))}`;

/** A changed value: the old one struck through on a danger tint, the new one on a good tint. */
function Change({ before, after, label }: { before: ReactNode; after: ReactNode; label: { before: string; now: string } }) {
  return (
    <span className="mt-1 flex flex-wrap items-center gap-1.5 text-small">
      <del className="rounded-sm bg-danger-tint px-1 text-danger-ink decoration-danger-ink/60"><span className="sr-only">{label.before}: </span>{before}</del>
      <span aria-hidden className="text-subtle">→</span>
      <ins className="rounded-sm bg-good-tint px-1 text-good-ink no-underline"><span className="sr-only">{label.now}: </span>{after}</ins>
    </span>
  );
}

/** Rows of a list; `what` adds the column of changed fields. Names link to the row in the workspace (removed rows: in the previous version). */
async function RowsTable({ rows, label, what, catalogId, previousId, removed = false, added = false }: { rows: DiffRow[]; label: string; what: boolean; catalogId: string; previousId: string; removed?: boolean; added?: boolean }) {
  const { locale, t, ta } = await getI18n();
  const d = ta.importX.diff;
  const notes = d.notes;
  const words = { before: d.before, now: ta.importX.flow.diff.now };
  const mark = added ? 'border-l-2 border-l-good' : removed ? 'border-l-2 border-l-danger' : undefined;
  return (
    <Table label={label}>
      <thead><tr><Th numeric className="w-14">#</Th><Th>{t.reviewProduct}</Th><Th>{ta.ws.colCurrent}</Th>{what ? <Th>{d.what}</Th> : null}</tr></thead>
      <tbody>
        {rows.map((r) => {
          const nameChanged = Boolean(r.before && r.notes?.includes('name'));
          const unitChanged = Boolean(r.before && r.notes?.includes('unit'));
          const codeChanged = Boolean(r.before && r.notes?.includes('code'));
          return (
            <tr key={`${r.rowIndex}|${r.name}`} className="hover:bg-surface">
              <Td numeric className={cx('align-top text-muted', mark)}>{fmtNumber(locale, r.rowIndex + 1)}</Td>
              <Td className="max-w-md align-top">
                <Link
                  href={rowHref(removed ? previousId : catalogId, r.name)} title={d.openRow}
                  className={cx('block truncate font-medium hover:text-brand-ink hover:underline', removed && 'text-muted line-through decoration-subtle')}
                >
                  {r.name}
                </Link>
                {r.unit && !unitChanged ? <span className="text-small text-muted">{r.unit}</span> : null}
                {nameChanged && r.before ? <Change before={<span className="break-words">{r.before.name}</span>} after={<span className="break-words">{r.name}</span>} label={words} /> : null}
                {unitChanged && r.before ? <Change before={r.before.unit ?? '-'} after={r.unit ?? '-'} label={words} /> : null}
              </Td>
              <Td className="align-top">
                {codeChanged && r.before ? (
                  <span className="flex flex-col items-start gap-1">
                    <span className="flex items-center gap-1.5 text-small text-muted">
                      <span className="sr-only">{d.before}: </span>
                      {r.before.code ? <span className="line-through decoration-danger-ink/70"><CodeChip code={r.before.code} /></span> : <span>{ta.ws.noCode}</span>}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span aria-hidden className="text-subtle">→</span>
                      {r.code ? <CodeChip code={r.code} /> : <span className="text-muted">{ta.ws.noCode}</span>}
                    </span>
                  </span>
                ) : r.code ? <CodeChip code={r.code} /> : <span className="text-muted">{ta.ws.noCode}</span>}
              </Td>
              {what ? (
                <Td className="align-top">
                  <span className="flex flex-wrap gap-1">
                    {r.notes?.map((n) => <Badge key={n} tone={n === 'nowRisky' ? 'danger' : n === 'nowSafe' ? 'good' : 'neutral'}>{notes[n]}</Badge>)}
                    {r.match === 'row' ? <span title={d.approxHint}><Badge tone="warn">{d.approx}</Badge></span> : null}
                  </span>
                </Td>
              ) : null}
            </tr>
          );
        })}
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
      <thead><tr><Th numeric className="w-14">#</Th><Th>{t.reviewProduct}</Th><Th>{d.decision}</Th><Th>{d.decidedBy}</Th></tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={`${r.rowIndex}|${r.type}`} className="hover:bg-surface">
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
async function NotLinked({ catalogId }: { catalogId: string }) {
  const { locale, ta } = await getI18n();
  const d = ta.importX.diff;
  const candidates = await orNotFound(serverApi().catalogs.versions({ catalogId }));
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
  await signedInUser();
  const { id } = await params;
  const sp = await searchParams;
  const against = sp.with;
  const show = KINDS.find((k) => k === sp.show) ?? null;
  const page = Math.max(0, Number.parseInt(sp.page ?? '1', 10) - 1 || 0);
  const window = show ? { limit: PAGE, offset: page * PAGE } : {};
  const catalog = await orNotFound(catalogHeader(id));
  const crumbs = [{ label: t.navCatalogs, href: '/catalogs' }, { label: catalog.filename, href: `/catalogs/${catalog.id}` }];
  // A chosen catalogue that is not the client's (or not ready) falls back to the linked version.
  const diff = await orNotFound(serverApi().catalogs.diff({ catalogId: catalog.id, ...(typeof against === 'string' && against ? { with: against } : {}), ...window }));

  if (!diff) {
    return <Page title={ta.diff.title} crumbs={crumbs}><NotLinked catalogId={catalog.id} /></Page>;
  }
  const c = diff.counts;
  const workspace = `/catalogs/${catalog.id}`;
  const lists: [Kind, string, number, DiffRow[], boolean][] = [
    ['changed', ta.diff.changed, c.changed, diff.changed, true],
    ['added', ta.diff.added, c.added, diff.added, false],
    ['removed', ta.diff.removed, c.removed, diff.removed, false],
    ['status', ta.diff.statusChanged, c.statusChanged, diff.statusChanged, true],
  ];
  const tabHref = (k: Kind | null): string => `/catalogs/${catalog.id}/diff${(() => {
    const q = new URLSearchParams({ ...(against ? { with: against } : {}), ...(k ? { show: k } : {}) }).toString();
    return q ? `?${q}` : '';
  })()}`;
  const table = (key: Kind, label: string, rows: DiffRow[], what: boolean) => (
    <RowsTable rows={rows} label={label} what={what} catalogId={catalog.id} previousId={diff.previousId} removed={key === 'removed'} added={key === 'added'} />
  );

  return (
    <Page
      title={ta.diff.title} hint={diff.linked ? ta.diff.hint : d.chosenHint} wide crumbs={crumbs}
      actions={(
        <>
          <ButtonLink href={api.catalogs.exportDiffCsv.url({ catalog: catalog.id, ...(against ? { with: against } : {}) })} variant="secondary" download><IconDownload size={16} />{d.exportCsv}</ButtonLink>
          <ButtonLink href={`/catalogs/${diff.previousId}`} variant="ghost">{diff.linked ? ta.diff.openPrevious : d.openChosen}</ButtonLink>
        </>
      )}
    >
      <p className="-mt-2 mb-5 inline-flex flex-wrap items-center gap-x-2 rounded-md bg-surface px-3 py-1.5 text-small text-muted">{d.comparedWith(diff.previous.filename, fmtDate(locale, diff.previous.createdAt))}</p>
      {/* Three across at most: the labels are long in both languages and must not be cut. */}
      <div className="mb-6 grid gap-3 sm:grid-cols-2 md:grid-cols-3">
        <Stat label={ta.diff.added} value={n(c.added)} tone={c.added > 0 ? 'good' : 'neutral'} href={c.added > 0 ? tabHref('added') : undefined} />
        <Stat label={ta.diff.removed} value={n(c.removed)} tone={c.removed > 0 ? 'danger' : 'neutral'} href={c.removed > 0 ? tabHref('removed') : undefined} />
        <Stat label={ta.diff.changed} value={n(c.changed)} tone={c.changed > 0 ? 'warn' : 'neutral'} href={c.changed > 0 ? tabHref('changed') : undefined} />
        <Stat label={d.unchanged} value={n(c.unchanged)} />
        {diff.linked ? <Stat label={d.carried} value={n(c.carried)} tone={c.carried > 0 ? 'good' : 'neutral'} href={c.carried > 0 ? '#carried' : undefined} /> : null}
        <Stat label={d.reReview} value={n(c.reReview)} tone={c.reReview > 0 ? 'warn' : 'neutral'} href={c.reReview > 0 ? '#rereview' : undefined} />
      </div>

      <div className="mb-6" aria-label={d.filterLabel} role="group">
        <Tabs
          items={([null, ...KINDS] as const).map((k) => ({
            href: tabHref(k),
            label: k === null ? d.showAll : k === 'status' ? ta.diff.statusChanged : ta.diff[k],
            active: k === show,
            ...(k === null ? {} : { count: k === 'status' ? c.statusChanged : c[k] }),
          }))}
        />
      </div>

      {show ? (() => {
        const list = lists.find(([key]) => key === show);
        if (!list) return null;
        const [key, label, count, rows, what] = list;
        const pages = Math.max(1, Math.ceil(count / PAGE));
        const at = (p: number): string => `/catalogs/${catalog.id}/diff?${new URLSearchParams({ ...(against ? { with: against } : {}), show, page: String(p + 1) }).toString()}`;
        return (
          <Section title={`${label} (${n(count)})`}>
            {rows.length === 0 ? <EmptyState size="compact" title={ta.importX.flow.diff.noRows} /> : table(key, label, rows, what)}
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
        {c.carried + c.reReview + c.changed + c.added + c.removed + c.statusChanged === 0 ? (
          <EmptyState size="compact" title={ta.importX.flow.diff.identical} hint={d.comparedWith(diff.previous.filename, fmtDate(locale, diff.previous.createdAt))} />
        ) : null}
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
            <Section
              title={`${label} (${n(count)})`}
              actions={count > rows.length ? <Link href={tabHref(key)} className="text-small font-medium text-brand-ink hover:underline">{label}: {n(count)}</Link> : null}
            >
              {table(key, label, rows, what)}
              {count > rows.length ? <p className="mt-2 text-small text-muted">{ta.diff.firstOnly(rows.length)}</p> : null}
            </Section>
          </div>
        )))}
      </div>
      )}
    </Page>
  );
}
