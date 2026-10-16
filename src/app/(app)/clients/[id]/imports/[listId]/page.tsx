import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { canSeeClient } from '@/lib/access';
import { codeDetails } from '@/lib/code-details';
import { db } from '@/lib/db';
import type { GroupDetail } from '@/lib/docs';
import { formatTag, getI18n } from '@/lib/locale';
import { currentUser } from '@/lib/session';
import { Badge } from '@/ui/badge';
import { AutoRefresh } from '@/ui/catalog-status-client';
import { CodeChip } from '@/ui/code-chip';
import { EmptyState } from '@/ui/empty-state';
import { Page } from '@/ui/page';
import { Table, Td, Th } from '@/ui/table';

export async function generateMetadata(): Promise<Metadata> {
  const { t, ta } = await getI18n();
  return { title: `${ta.docs.reportTitle.cheques} — ${t.appName}` };
}

const ISSUES = ['INVALID_CODE', 'MISSING_CODE', 'MISMATCH', 'UNIT_CONFLICT', 'NOT_IN_CATALOG', 'NOT_PURCHASED'] as const;
const SHOWN = 300;

export default async function DocReportPage({ params, searchParams }: { params: Promise<{ id: string; listId: string }>; searchParams: Promise<{ issue?: string }> }) {
  const { locale, ta } = await getI18n();
  const tag = formatTag(locale);
  const user = await currentUser();
  if (!user) redirect('/sign-in');
  const { id, listId } = await params;
  const list = await db.docList.findFirst({ where: { id: listId, orgId: user.orgId, clientId: id } });
  if (!list || !canSeeClient(user, list.clientId)) notFound();
  const kind = list.kind === 'sales' ? 'sales' : 'cheques';
  const back = <Link href={`/clients/${id}/imports?kind=${kind}`} className="text-sm text-brand hover:underline">← {ta.docs.title}</Link>;

  if (list.status === 'analyzing' || list.status === 'uploaded') {
    const pct = list.progressTotal === 0 ? 0 : Math.round((list.progressDone / list.progressTotal) * 100);
    return (
      <Page title={ta.docs.reportTitle[kind]}>
        <div className="-mt-3 mb-5">{back}</div>
        <p className="text-lg font-bold">{ta.docs.analyzing(list.progressDone, list.progressTotal)}</p>
        <div className="mt-3 h-2 max-w-xl overflow-hidden rounded-full bg-surface"><div className="h-full rounded-full bg-brand transition-[width]" style={{ width: `${pct}%` }} /></div>
        {list.status === 'analyzing' ? <AutoRefresh intervalMs={2000} /> : <p className="mt-3 text-sm text-muted">{ta.docs.notStarted}</p>}
      </Page>
    );
  }
  if (list.status === 'failed') {
    return <Page title={ta.docs.reportTitle[kind]}><div className="-mt-3 mb-5">{back}</div><EmptyState tone="danger" title={ta.docs.failed} hint={list.error ?? undefined} /></Page>;
  }

  const groups = await db.docGroup.findMany({ where: { listId }, orderBy: [{ amount: { sort: 'desc', nulls: 'last' } }, { lines: 'desc' }] });
  const sp = await searchParams;
  const issue = ISSUES.find((i) => i === sp.issue) ?? null;
  const flagged = groups.filter((g) => g.issues.length > 0);
  const shown = (issue ? flagged.filter((g) => g.issues.includes(issue)) : flagged).slice(0, SHOWN);
  const details = await codeDetails(shown.flatMap((g) => [g.mxik, g.suggestedMxik]));
  const money = (n: number): string => n.toLocaleString(tag, { maximumFractionDigits: 0 });
  const totalLines = groups.reduce((n, g) => n + g.lines, 0);
  const flaggedLines = flagged.reduce((n, g) => n + g.lines, 0);

  const summary = ISSUES.map((i) => {
    const hit = flagged.filter((g) => g.issues.includes(i));
    return { issue: i, groups: hit.length, lines: hit.reduce((n, g) => n + g.lines, 0), amount: hit.reduce((n, g) => n + Number(g.amount ?? 0), 0), hasAmount: hit.some((g) => g.amount !== null) };
  }).filter((s) => s.groups > 0);
  const named = (code: string | null) => (code ? <span className="flex min-w-0 flex-col items-start gap-0.5"><CodeChip code={code} /><span className="max-w-full truncate text-xs text-muted" title={details.get(code)?.name}>{details.get(code)?.name ?? ta.drawer.unknown}</span></span> : <span className="text-muted">—</span>);

  return (
    <Page title={ta.docs.reportTitle[kind]} hint={ta.docs.reportHint[kind]} wide>
      <div className="-mt-3 mb-5">{back}</div>
      <dl className="mb-5 flex flex-wrap gap-8">
        <div><dt className="text-xs text-muted">{ta.docs.lines}</dt><dd className="text-2xl font-bold">{totalLines.toLocaleString(tag)}</dd></div>
        <div><dt className="text-xs text-muted">{ta.docs.flaggedLines}</dt><dd className={`text-2xl font-bold ${flaggedLines > 0 ? 'text-danger' : 'text-good'}`}>{flaggedLines.toLocaleString(tag)}</dd></div>
        <div><dt className="text-xs text-muted">{ta.docs.groups}</dt><dd className="text-2xl font-bold">{flagged.length.toLocaleString(tag)} / {groups.length.toLocaleString(tag)}</dd></div>
      </dl>
      {summary.length === 0 ? <EmptyState title={ta.docs.clean} hint={ta.docs.cleanHint} /> : (
        <>
          <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {summary.map((s) => (
              <Link key={s.issue} href={`/clients/${id}/imports/${listId}?issue=${s.issue}`} className={`rounded-ctl border px-4 py-3 hover:bg-surface ${issue === s.issue ? 'border-brand bg-brand-tint' : 'border-line'}`}>
                <p className="font-medium">{ta.docs.issues[s.issue]}</p>
                <p className="mt-1 text-sm text-muted">{ta.docs.groupsAndLines(s.groups, s.lines)}</p>
                {s.hasAmount ? <p className="text-sm">{ta.docs.amountLabel[kind]}: <span className="font-bold">{money(s.amount)}</span></p> : null}
              </Link>
            ))}
          </div>
          {issue ? <p className="mb-3 text-sm"><Link href={`/clients/${id}/imports/${listId}`} className="text-brand hover:underline">{ta.docs.allIssues}</Link></p> : null}
          <Table>
            <thead><tr><Th>{ta.docs.colProduct}</Th><Th>{ta.docs.colUsed}</Th><Th>{ta.docs.colUnit}</Th><Th className="text-right">{ta.docs.colLines}</Th><Th className="text-right">{ta.docs.colAmount}</Th><Th>{ta.docs.colIssues}</Th><Th>{ta.docs.colSuggested}</Th><Th>{ta.docs.colCatalog}</Th></tr></thead>
            <tbody>
              {shown.map((g) => {
                const detail = g.detail as unknown as GroupDetail;
                const names = Array.isArray(g.names) ? (g.names as string[]) : [];
                return (
                  <tr key={g.id} className="align-top hover:bg-surface/60">
                    <Td className="max-w-xs"><span className="block truncate font-medium" title={names.join('\n')}>{g.name ?? '—'}</span>{names.length > 1 ? <span className="text-xs text-muted">+{names.length - 1}</span> : null}</Td>
                    <Td className="max-w-[240px]">{named(g.mxik)}</Td>
                    <Td className="text-muted">{g.unit ?? ''}</Td>
                    <Td className="text-right">{g.lines.toLocaleString(tag)}</Td>
                    <Td className="text-right">{g.amount === null ? '' : money(Number(g.amount))}</Td>
                    <Td><span className="flex flex-wrap gap-1">{g.issues.map((i) => <Badge key={i} tone={i === 'INVALID_CODE' || i === 'MISSING_CODE' ? 'danger' : 'warn'}>{ta.docs.issues[i as (typeof ISSUES)[number]] ?? i}</Badge>)}</span></Td>
                    <Td className="max-w-[240px]">{named(g.suggestedMxik)}</Td>
                    <Td className="max-w-[200px]">
                      {detail.catalogMatches?.map((m) => <Link key={`${m.catalogId}|${m.rowIndex}`} href={`/catalogs/${m.catalogId}?q=${encodeURIComponent(m.name)}&pending=0&v=0`} className="block truncate text-sm text-brand hover:underline" title={m.name}>#{m.rowIndex + 1} {m.name}</Link>)}
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
