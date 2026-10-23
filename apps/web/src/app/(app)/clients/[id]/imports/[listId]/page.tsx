import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import type { endpoints, ResponseOf } from '@tasnivo/contracts';
import { canWrite } from '@/lib/pure/access';
import { fmtNumber } from '@tasnivo/i18n/format';
import { pageData } from '@/lib/api/page-data';
import { serverApi } from '@/lib/api/server';
import { getI18n } from '@/lib/locale';
import { Badge } from '@/ui/badge';
import { ButtonLink } from '@/ui/button';
import { CodeChip } from '@/ui/code-chip';
import { cx } from '@/ui/cx';
import { EmptyState } from '@/ui/empty-state';
import { Page } from '@/ui/page';
import { Progress } from '@/ui/progress';
import { Stat } from '@/ui/stat';
import { Table, Td, Th } from '@/ui/table';
import { Card, FLUSH_TABLE } from '../../../../_manage/card';
import { ListFlow } from '../../../../_manage/list-flow';
import { Notice } from '../../../../_manage/notice';
import { RestartDocButton } from '../restart-button';
import { AutoRefresh } from './auto-refresh';

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
        <ListFlow step={1}>
          <Card>
            <EmptyState
              size="compact" title={ta.docs.notStarted}
              action={writable ? <ButtonLink href={`/clients/${id}/imports?kind=${kind}&map=${list.id}`} variant="primary">{ta.importX.lists.resume}</ButtonLink> : undefined}
            />
          </Card>
        </ListFlow>
      </Page>
    );
  }
  if (list.status === 'analyzing') {
    const stale = list.stale;
    const heading = ta.docs.analyzing(list.progressDone, list.progressTotal);
    return (
      <Page title={ta.docs.reportTitle[kind]} crumbs={crumbs}>
        <ListFlow step={2}>
          <Card className="max-w-2xl">
            <section aria-live="polite" className="space-y-3">
              <p className="text-section">{heading}</p>
              <Progress label={heading} hideLabel value={list.progressTotal > 0 ? list.progressDone : undefined} max={Math.max(list.progressTotal, 1)} />
              {stale ? (
                <Notice tone="warn" title={d.stalled} action={writable ? <RestartDocButton listId={list.id} /> : undefined} />
              ) : <AutoRefresh intervalMs={2000} />}
            </section>
          </Card>
        </ListFlow>
      </Page>
    );
  }
  if (list.status === 'failed') {
    return (
      <Page title={ta.docs.reportTitle[kind]} crumbs={crumbs}>
        <Card>
          <EmptyState tone="danger" size="compact" title={ta.docs.failed} hint={d.failedHint} action={writable ? <RestartDocButton listId={list.id} /> : undefined} />
        </Card>
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
  const matching = issue ? flagged.filter((g) => g.issues.includes(issue)) : flagged;
  const shown = matching.slice(0, SHOWN);
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
  const named = (code: string | null) => (code ? <span className="flex min-w-0 flex-col items-start gap-0.5"><CodeChip code={code} /><span className="max-w-full truncate text-micro text-muted" title={codeNames.get(code)}>{codeNames.get(code) ?? ta.drawer.unknown}</span></span> : <span className="text-muted">—</span>);

  return (
    <Page title={ta.docs.reportTitle[kind]} hint={ta.docs.reportHint[kind]} wide crumbs={crumbs}>
      {notes.length > 0 ? <Notice tone="warn" className="mb-5">{notes.map((note) => <p key={note}>{note}</p>)}</Notice> : null}
      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label={ta.docs.lines} value={num(totalLines)} />
        <Stat label={ta.docs.flaggedLines} value={num(flaggedLines)} tone={flaggedLines > 0 ? 'danger' : 'good'} />
        <Stat label={ta.docs.groups} value={`${num(flagged.length)} / ${num(groups.length)}`} />
      </div>
      {summary.length === 0 ? <Card><EmptyState size="compact" title={ta.docs.clean} hint={ta.docs.cleanHint} /></Card> : (
        <>
          <ul className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {summary.map((s) => {
              const current = issue === s.issue;
              return (
                <li key={s.issue}>
                  <Link
                    href={`/clients/${id}/imports/${listId}?issue=${s.issue}`}
                    aria-current={current ? 'true' : undefined}
                    className={cx(
                      'block h-full rounded-lg border px-4 py-3 transition-colors duration-(--duration-fast)',
                      current ? 'border-brand bg-brand-tint' : 'border-line bg-raised hover:border-line-strong hover:bg-surface',
                    )}
                  >
                    <span className="block font-medium">{ta.docs.issues[s.issue]}</span>
                    <span className="mt-1 block text-small text-muted">{ta.docs.groupsAndLines(s.groups, s.lines)}</span>
                    {s.hasAmount ? <span className="block text-small">{ta.docs.amountLabel[kind]}: <span className="font-semibold tabular-nums">{num(s.amount)}</span></span> : null}
                  </Link>
                </li>
              );
            })}
          </ul>
          {issue ? <p className="mb-3 text-small"><Link href={`/clients/${id}/imports/${listId}`} className="font-medium text-brand-ink hover:underline">{ta.docs.allIssues}</Link></p> : null}
          <Card flush>
            <Table label={ta.docs.reportTitle[kind]} className={FLUSH_TABLE}>
              <thead><tr><Th>{ta.docs.colProduct}</Th><Th>{ta.docs.colUsed}</Th><Th>{ta.docs.colUnit}</Th><Th numeric>{ta.docs.colLines}</Th><Th numeric>{ta.docs.colAmount}</Th><Th>{ta.docs.colIssues}</Th><Th>{ta.docs.colSuggested}</Th><Th>{ta.docs.colCatalog}</Th></tr></thead>
              <tbody>
                {shown.map((g) => {
                  const detail = g.detail;
                  const names = g.names;
                  return (
                    <tr key={g.id} className="align-top hover:bg-surface">
                      <Td className="max-w-xs"><span className="block truncate font-medium" title={names.join('\n')}>{g.name ?? '—'}</span>{names.length > 1 ? <span className="text-micro text-muted">+{names.length - 1}</span> : null}</Td>
                      <Td className="max-w-[240px]">{named(g.mxik)}</Td>
                      <Td className="text-muted">{g.unit ?? ''}</Td>
                      <Td numeric>{num(g.lines)}</Td>
                      <Td numeric>{g.amount === null ? '' : num(g.amount)}</Td>
                      <Td><span className="flex flex-wrap gap-1">{g.issues.map((i) => <Badge key={i} tone={i === 'INVALID_CODE' || i === 'MISSING_CODE' ? 'danger' : 'warn'}>{ta.docs.issues[i as (typeof ISSUES)[number]] ?? i}</Badge>)}</span></Td>
                      <Td className="max-w-[240px]">{named(g.suggestedMxik)}</Td>
                      <Td className="max-w-[200px]">
                        {detail.catalogMatches?.map((m) => <Link key={`${m.catalogId}|${m.rowIndex}`} href={`/catalogs/${m.catalogId}?q=${encodeURIComponent(m.name)}&pending=0&v=0`} className="block truncate text-small text-brand-ink hover:underline" title={m.name}>#{num(m.rowIndex + 1)} {m.name}</Link>)}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </Card>
          {matching.length > SHOWN ? <p className="mt-2 text-micro text-muted">{ta.diff.firstOnly(SHOWN)}</p> : null}
        </>
      )}
    </Page>
  );
}
