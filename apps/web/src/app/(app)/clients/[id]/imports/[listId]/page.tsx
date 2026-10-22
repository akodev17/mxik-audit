import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import type { endpoints, ResponseOf } from '@tasnivo/contracts';
import { Notice } from '@/app/(app)/upload/notice';
import { canWrite } from '@tasnivo/domain/access';
import { fmtNumber } from '@tasnivo/i18n/format';
import { pageData } from '@/lib/api/page-data';
import { serverApi } from '@/lib/api/server';
import { getI18n } from '@/lib/locale';
import { Badge } from '@/ui/badge';
import { ButtonLink } from '@/ui/button';
import { AutoRefresh } from '@/ui/catalog-status-client';
import { CodeChip } from '@/ui/code-chip';
import { EmptyState } from '@/ui/empty-state';
import { Page } from '@/ui/page';
import { Progress } from '@/ui/progress';
import { Table, Td, Th } from '@/ui/table';
import { RestartDocButton } from '../restart-button';

type Report = ResponseOf<typeof endpoints.imports.doc>;
type ReportList = Report['list'];
type ReportGroup = Report['groups'][number];

/** One API read per request, shared by generateMetadata and the page. */
const readReport = cache((listId: string) => serverApi().imports.doc({ listId }));

export async function generateMetadata({ params }: { params: Promise<{ id: string; listId: string }> }): Promise<Metadata> {
  const { t, ta } = await getI18n();
  const { id, listId } = await params;
  const list = await readReport(listId).then((r) => r.list, () => null);
  // The tab names the list's kind only for someone who may open it (the API answers 404 otherwise).
  const title = list && list.clientId === id ? ta.docs.reportTitle[list.kind === 'sales' ? 'sales' : 'cheques'] : ta.docs.title;
  return { title: `${title} — ${t.appName}` };
}

const ISSUES = ['INVALID_CODE', 'MISSING_CODE', 'MISMATCH', 'UNIT_CONFLICT', 'NOT_IN_CATALOG', 'NOT_PURCHASED'] as const;
const SHOWN = 300;

export default async function DocReportPage({ params, searchParams }: { params: Promise<{ id: string; listId: string }>; searchParams: Promise<{ issue?: string }> }) {
  const { locale, t, ta } = await getI18n();
  const { id, listId } = await params;
  const [user, report] = await Promise.all([pageData(serverApi().auth.me()), pageData(readReport(listId))]);
  const list: ReportList = report.list;
  if (list.clientId !== id) notFound();
  const kind = list.kind === 'sales' ? 'sales' : 'cheques';
  const writable = canWrite(user) && !user.demo;
  const crumbs = [
    { label: t.clientsTitle, href: '/clients' },
    { label: list.clientName, href: `/clients/${id}` },
    { label: ta.docs.title, href: `/clients/${id}/imports?kind=${kind}` },
  ];
  const d = ta.importX.docs;

  if (list.status === 'uploaded') {
    return (
      <Page title={ta.docs.reportTitle[kind]} crumbs={crumbs}>
        <EmptyState
          title={ta.docs.notStarted}
          action={writable ? <ButtonLink href={`/clients/${id}/imports?kind=${kind}&map=${list.id}`} variant="primary">{ta.importX.lists.resume}</ButtonLink> : undefined}
        />
      </Page>
    );
  }
  if (list.status === 'analyzing') {
    const stale = list.stale;
    const heading = ta.docs.analyzing(list.progressDone, list.progressTotal);
    return (
      <Page title={ta.docs.reportTitle[kind]} crumbs={crumbs}>
        <section aria-live="polite" className="max-w-xl space-y-3">
          <p className="text-section">{heading}</p>
          <Progress label={heading} hideLabel value={list.progressTotal > 0 ? list.progressDone : undefined} max={Math.max(list.progressTotal, 1)} />
          {stale ? (
            <Notice tone="warn" title={d.stalled} action={writable ? <RestartDocButton listId={list.id} /> : undefined} />
          ) : <AutoRefresh intervalMs={2000} />}
        </section>
      </Page>
    );
  }
  if (list.status === 'failed') {
    return (
      <Page title={ta.docs.reportTitle[kind]} crumbs={crumbs}>
        <EmptyState tone="danger" title={ta.docs.failed} hint={d.failedHint} action={writable ? <RestartDocButton listId={list.id} /> : undefined} />
      </Page>
    );
  }
  const notes = [
    ...(list.truncated && list.totalSeen ? [d.rowsCapped(list.rowCount, list.totalSeen)] : []),
    ...(list.groupsTotal !== null && list.groupsChecked !== null && list.groupsTotal > list.groupsChecked ? [d.groupsCapped(list.groupsChecked, list.groupsTotal)] : []),
    ...(list.ambiguous ? [ta.importX.lists.ambiguous(list.ambiguous)] : []),
  ];

  // Every group of the finished check, largest amount first; the issue filter stays here because the
  // summary cards and totals count all of them.
  const groups: ReportGroup[] = report.groups;
  const sp = await searchParams;
  const issue = ISSUES.find((i) => i === sp.issue) ?? null;
  const flagged = groups.filter((g) => g.issues.length > 0);
  const shown = (issue ? flagged.filter((g) => g.issues.includes(issue)) : flagged).slice(0, SHOWN);
  // The classifier names of the codes used and suggested, as the API sends them with each group.
  const codeNames = new Map<string, string>();
  for (const g of groups) {
    if (g.mxik && g.mxikName) codeNames.set(g.mxik, g.mxikName);
    if (g.suggestedMxik && g.suggestedName) codeNames.set(g.suggestedMxik, g.suggestedName);
  }
  const num = (n: number): string => fmtNumber(locale, n);
  const totalLines = groups.reduce((n, g) => n + g.lines, 0);
  const flaggedLines = flagged.reduce((n, g) => n + g.lines, 0);

  const summary = ISSUES.map((i) => {
    const hit = flagged.filter((g) => g.issues.includes(i));
    return { issue: i, groups: hit.length, lines: hit.reduce((n, g) => n + g.lines, 0), amount: hit.reduce((n, g) => n + Number(g.amount ?? 0), 0), hasAmount: hit.some((g) => g.amount !== null) };
  }).filter((s) => s.groups > 0);
  const named = (code: string | null) => (code ? <span className="flex min-w-0 flex-col items-start gap-0.5"><CodeChip code={code} /><span className="max-w-full truncate text-xs text-muted" title={codeNames.get(code)}>{codeNames.get(code) ?? ta.drawer.unknown}</span></span> : <span className="text-muted">—</span>);

  return (
    <Page title={ta.docs.reportTitle[kind]} hint={ta.docs.reportHint[kind]} wide crumbs={crumbs}>
      {notes.length > 0 ? <Notice tone="warn" className="mb-5">{notes.map((note) => <p key={note}>{note}</p>)}</Notice> : null}
      <dl className="mb-5 flex flex-wrap gap-8">
        <div><dt className="text-xs text-muted">{ta.docs.lines}</dt><dd className="text-2xl font-bold">{num(totalLines)}</dd></div>
        <div><dt className="text-xs text-muted">{ta.docs.flaggedLines}</dt><dd className={`text-2xl font-bold ${flaggedLines > 0 ? 'text-danger' : 'text-good'}`}>{num(flaggedLines)}</dd></div>
        <div><dt className="text-xs text-muted">{ta.docs.groups}</dt><dd className="text-2xl font-bold">{num(flagged.length)} / {num(groups.length)}</dd></div>
      </dl>
      {summary.length === 0 ? <EmptyState title={ta.docs.clean} hint={ta.docs.cleanHint} /> : (
        <>
          <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {summary.map((s) => (
              <Link key={s.issue} href={`/clients/${id}/imports/${listId}?issue=${s.issue}`} className={`rounded-ctl border px-4 py-3 hover:bg-surface ${issue === s.issue ? 'border-brand bg-brand-tint' : 'border-line'}`}>
                <p className="font-medium">{ta.docs.issues[s.issue]}</p>
                <p className="mt-1 text-sm text-muted">{ta.docs.groupsAndLines(s.groups, s.lines)}</p>
                {s.hasAmount ? <p className="text-sm">{ta.docs.amountLabel[kind]}: <span className="font-bold">{num(s.amount)}</span></p> : null}
              </Link>
            ))}
          </div>
          {issue ? <p className="mb-3 text-sm"><Link href={`/clients/${id}/imports/${listId}`} className="text-brand hover:underline">{ta.docs.allIssues}</Link></p> : null}
          <Table>
            <thead><tr><Th>{ta.docs.colProduct}</Th><Th>{ta.docs.colUsed}</Th><Th>{ta.docs.colUnit}</Th><Th className="text-right">{ta.docs.colLines}</Th><Th className="text-right">{ta.docs.colAmount}</Th><Th>{ta.docs.colIssues}</Th><Th>{ta.docs.colSuggested}</Th><Th>{ta.docs.colCatalog}</Th></tr></thead>
            <tbody>
              {shown.map((g) => {
                const detail = g.detail;
                const names = g.names;
                return (
                  <tr key={g.id} className="align-top hover:bg-surface/60">
                    <Td className="max-w-xs"><span className="block truncate font-medium" title={names.join('\n')}>{g.name ?? '—'}</span>{names.length > 1 ? <span className="text-xs text-muted">+{names.length - 1}</span> : null}</Td>
                    <Td className="max-w-[240px]">{named(g.mxik)}</Td>
                    <Td className="text-muted">{g.unit ?? ''}</Td>
                    <Td className="text-right">{num(g.lines)}</Td>
                    <Td className="text-right">{g.amount === null ? '' : num(g.amount)}</Td>
                    <Td><span className="flex flex-wrap gap-1">{g.issues.map((i) => <Badge key={i} tone={i === 'INVALID_CODE' || i === 'MISSING_CODE' ? 'danger' : 'warn'}>{ta.docs.issues[i as (typeof ISSUES)[number]] ?? i}</Badge>)}</span></Td>
                    <Td className="max-w-[240px]">{named(g.suggestedMxik)}</Td>
                    <Td className="max-w-[200px]">
                      {detail.catalogMatches?.map((m) => <Link key={`${m.catalogId}|${m.rowIndex}`} href={`/catalogs/${m.catalogId}?q=${encodeURIComponent(m.name)}&pending=0&v=0`} className="block truncate text-sm text-brand hover:underline" title={m.name}>#{num(m.rowIndex + 1)} {m.name}</Link>)}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
          {(issue ? flagged.filter((g) => g.issues.includes(issue)) : flagged).length > SHOWN ? <p className="mt-2 text-xs text-muted">{ta.diff.firstOnly(SHOWN)}</p> : null}
        </>
      )}
    </Page>
  );
}
