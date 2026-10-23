'use client';

import Link from 'next/link';
import { useMemo, useState, type ReactNode } from 'react';
import type { endpoints, QueryOf, ResponseOf } from '@tasnivo/contracts';
import { fmtDate, fmtDateTime, fmtNumber } from '@tasnivo/i18n/format';
import { api } from '@/lib/api/browser';
import { useI18n } from '@/lib/locale-client';
import { groupDecisions, type ActivityEntry, type ActivityRow } from '@/lib/pure/activity-groups';
import { Button } from '@/ui/button';
import { CodeChip } from '@/ui/code-chip';
import { cx } from '@/ui/cx';
import { IconBook, IconDownload, IconSuccess, IconTable, IconUpload, IconUsers } from '@/ui/icons';
import { groupByDay, timeOfDay } from '@/ui/shell/day-groups';
import { IconHash, IconTeam } from '@/ui/shell/icons';
import { actionText, actorText, catalogText, codeParts, entryHead, entryKind, entryTitle, type EntryKind } from './entry-text';

type Answer = ResponseOf<typeof endpoints.account.activity>;
type WireRow = Answer['rows'][number];
export type ActivityQuery = Omit<QueryOf<typeof endpoints.account.activity>, 'page'>;

const MARK: Record<EntryKind, { icon: ReactNode; tone: string }> = {
  decision: { icon: <IconSuccess size={15} />, tone: 'bg-good-tint text-good-ink' },
  upload: { icon: <IconUpload size={15} />, tone: 'bg-info-tint text-info-ink' },
  export: { icon: <IconDownload size={15} />, tone: 'bg-brand-tint text-brand-ink' },
  share: { icon: <IconUsers size={15} />, tone: 'bg-brand-tint text-brand-ink' },
  client: { icon: <IconUsers size={15} />, tone: 'bg-sunken text-muted' },
  team: { icon: <IconTeam size={15} />, tone: 'bg-sunken text-muted' },
  classifier: { icon: <IconHash size={15} />, tone: 'bg-warn-tint text-warn-ink' },
  dictionary: { icon: <IconBook size={15} />, tone: 'bg-sunken text-muted' },
  other: { icon: <IconTable size={15} />, tone: 'bg-sunken text-muted' },
};

const revive = (rows: readonly WireRow[]): ActivityRow[] => rows.map((r) => ({ ...r, at: new Date(r.at) }));

/** A text with its 17-digit codes as code chips. */
function WithCodes({ text }: { text: string }) {
  return <>{codeParts(text).map((p, i) => (p.code ? <CodeChip key={i} code={p.text} className="mx-0.5 align-baseline" /> : <span key={i}>{p.text}</span>))}</>;
}

/**
 * The activity log as a timeline: entries grouped by day, each with a mark for its kind, what happened (codes
 * as code chips), who did it, for which client and catalogue. A folded run of decisions opens to its events.
 * The first page comes from the server; "show more" reads the next pages from the API with the same filters.
 * `now` is the server's clock, so the day names agree after hydration.
 */
export function ActivityTimeline({ query, first, now }: {
  query: ActivityQuery;
  first: { rows: WireRow[]; hasMore: boolean; total: number; pageSize: number; page: number };
  now: number;
}) {
  const { locale, ta } = useI18n();
  const words = ta.firmX.log;
  const [rows, setRows] = useState<WireRow[]>(first.rows);
  const [nextPage, setNextPage] = useState(first.page + 1);
  const [hasMore, setHasMore] = useState(first.hasMore);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const entries = useMemo(() => groupDecisions(revive(rows)), [rows]);
  const days = groupByDay(entries, (e) => entryHead(e)?.at ?? now, now);
  // Rows shown so far, counting the pages before the first one when the address asked for a later page.
  const shown = (first.page - 1) * first.pageSize + rows.length;

  const loadMore = async (): Promise<void> => {
    setLoading(true);
    setFailed(false);
    try {
      const answer = await api.account.activity({ ...query, page: nextPage - 1 });
      setRows((current) => {
        const seen = new Set(current.map((r) => r.id));
        return [...current, ...answer.rows.filter((r) => !seen.has(r.id))];
      });
      setHasMore(answer.hasMore && answer.rows.length > 0);
      setNextPage((p) => p + 1);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  };

  const when = (entry: ActivityEntry, head: ActivityRow): string => {
    const time = timeOfDay(fmtDateTime(locale, head.at));
    if (entry.kind === 'event' || entry.first.getTime() === entry.last.getTime()) return time;
    return `${timeOfDay(fmtDateTime(locale, entry.first))}–${timeOfDay(fmtDateTime(locale, entry.last))}`;
  };

  return (
    <section aria-label={ta.log.title}>
      <div className="space-y-6">
        {days.map((d) => (
          <div key={d.day}>
            <h2 className="sticky top-0 z-sticky -mx-1 mb-2 flex items-baseline gap-2 bg-base/95 px-1 py-1.5 text-small font-semibold text-muted backdrop-blur-sm">
              {d.name === 'today' ? ta.shellX.notices.today : d.name === 'yesterday' ? ta.shellX.notices.yesterday : fmtDate(locale, d.day)}
              {d.name ? <span className="font-normal text-subtle">{fmtDate(locale, d.day)}</span> : null}
            </h2>
            <ol className="rounded-lg border border-line bg-raised px-4 py-1 sm:px-5">
              {d.items.map((entry) => {
                const head = entryHead(entry);
                if (!head) return null;
                const mark = MARK[entryKind(head.action)];
                const catalog = catalogText(head, ta);
                return (
                  <li key={entry.kind === 'event' ? head.id : `group-${head.id}`} className="relative flex gap-3.5 py-3 [&:not(:last-child)]:before:absolute [&:not(:last-child)]:before:bottom-[-0.75rem] [&:not(:last-child)]:before:left-4 [&:not(:last-child)]:before:top-11 [&:not(:last-child)]:before:w-px [&:not(:last-child)]:before:bg-line">
                    <span aria-hidden className={cx('relative grid size-8 shrink-0 place-items-center rounded-full', mark.tone)}>{mark.icon}</span>
                    <div className="min-w-0 flex-1 pt-1">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                        {entry.kind === 'event' ? (
                          <p className="min-w-0 font-medium text-fg"><WithCodes text={actionText(entry.row, ta, locale)} /></p>
                        ) : (
                          <details className="group min-w-0">
                            <summary className="cursor-pointer list-none font-medium text-fg marker:hidden [&::-webkit-details-marker]:hidden">
                              {entryTitle(entry, ta, locale)}
                              <span className="ml-2 text-small font-normal text-brand-ink group-open:hidden">{words.groupDetails}</span>
                            </summary>
                            <ul className="mt-2 space-y-1 border-l-2 border-line pl-3 text-small">
                              {entry.rows.map((r) => (
                                <li key={r.id}>
                                  <span className="tabular-nums text-muted">{timeOfDay(fmtDateTime(locale, r.at))}</span>{' '}
                                  <WithCodes text={actionText(r, ta, locale)} />
                                  {r.product ? <span className="text-muted [overflow-wrap:anywhere]"> — <WithCodes text={r.product} /></span> : null}
                                </li>
                              ))}
                            </ul>
                          </details>
                        )}
                        <time dateTime={head.at.toISOString()} className="shrink-0 text-micro tabular-nums text-muted" title={fmtDateTime(locale, head.at)}>{when(entry, head)}</time>
                      </div>
                      {entry.kind === 'event' && entry.row.product ? (
                        <p className="mt-0.5 text-small text-muted [overflow-wrap:anywhere]"><WithCodes text={entry.row.product} /></p>
                      ) : null}
                      <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-small text-muted">
                        <span className="min-w-0 [overflow-wrap:anywhere]">{actorText(head, ta)}</span>
                        {head.clientName ? (
                          <>
                            <span aria-hidden className="text-subtle">·</span>
                            {head.clientId ? <Link href={`/clients/${head.clientId}`} className="hover:text-brand-ink hover:underline">{head.clientName}</Link> : <span>{head.clientName}</span>}
                          </>
                        ) : null}
                        {catalog ? (
                          head.catalogId
                            ? <Link href={`/catalogs/${head.catalogId}`} title={catalog} className="inline-flex max-w-full items-center gap-1 rounded-sm bg-sunken px-1.5 py-0.5 text-micro font-medium text-fg hover:text-brand-ink"><IconTable size={12} /><span className="truncate">{catalog}</span></Link>
                            : <span title={catalog} className="inline-flex max-w-full items-center gap-1 rounded-sm bg-sunken px-1.5 py-0.5 text-micro text-muted"><IconTable size={12} /><span className="truncate">{catalog}</span></span>
                        ) : null}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        ))}
      </div>

      <div className="mt-5 flex flex-col items-center gap-2 text-center">
        <p className="text-small tabular-nums text-muted" aria-live="polite">
          {hasMore ? words.shown(fmtNumber(locale, shown), fmtNumber(locale, first.total)) : words.allShown}
        </p>
        {failed ? <p role="alert" className="text-small text-danger-ink">{words.loadFailed}</p> : null}
        {hasMore ? <Button variant="secondary" loading={loading} onClick={() => { void loadMore(); }}>{words.loadMore}</Button> : null}
      </div>
    </section>
  );
}
