import Link from 'next/link';
import type { ReactNode } from 'react';
import type { ActivityRow } from '@/lib/activity';
import type { ActivityEntry } from '@/lib/activity-groups';
import { fmtDateTime, isoDay } from '@/lib/format';
import { getI18n } from '@/lib/locale';
import { Table, Td, Th } from '@/ui/table';
import { actionText, actorText, catalogText, entryHead, entryTitle } from './entry-text';

/** The full log: a table on wide screens, cards on a phone. A folded run of decisions opens to its events. */
export async function ActivityTable({ entries }: { entries: ActivityEntry[] }) {
  const { locale, ta } = await getI18n();

  const client = (r: ActivityRow): ReactNode => (r.clientName
    ? r.clientId ? <Link href={`/clients/${r.clientId}`} className="hover:text-fg hover:underline">{r.clientName}</Link> : r.clientName
    : null);
  const catalog = (r: ActivityRow): ReactNode => {
    const text = catalogText(r, ta);
    if (!text) return null;
    return r.catalogId
      ? <Link href={`/catalogs/${r.catalogId}`} className="text-brand-ink hover:underline" title={text}>{text}</Link>
      : <span className="text-muted" title={text}>{text}</span>;
  };
  const what = (entry: ActivityEntry): ReactNode => {
    if (entry.kind === 'event') {
      return <>{actionText(entry.row, ta, locale)}{entry.row.product ? <span className="block text-small text-muted [overflow-wrap:anywhere]">{entry.row.product}</span> : null}</>;
    }
    return (
      <details className="group">
        <summary className="cursor-pointer list-none font-medium marker:hidden [&::-webkit-details-marker]:hidden">
          {entryTitle(entry, ta, locale)}
          <span className="ml-2 text-small font-normal text-brand-ink group-open:hidden">{ta.firmX.log.groupDetails}</span>
        </summary>
        <ul className="mt-2 space-y-1 border-l border-line pl-3 text-small">
          {entry.rows.map((r) => (
            <li key={r.id}>
              <span className="tabular-nums text-muted">{fmtDateTime(locale, r.at)}</span>{' '}
              {actionText(r, ta, locale)}
              {r.product ? <span className="text-muted [overflow-wrap:anywhere]"> — {r.product}</span> : null}
            </li>
          ))}
        </ul>
      </details>
    );
  };
  const when = (entry: ActivityEntry, head: ActivityRow): string => {
    if (entry.kind === 'event' || entry.first.getTime() === entry.last.getTime()) return fmtDateTime(locale, head.at);
    const end = fmtDateTime(locale, entry.last);
    // Same day: "20.10.2026 14:05 – 14:30".
    return `${fmtDateTime(locale, entry.first)} – ${isoDay(entry.first) === isoDay(entry.last) ? end.slice(end.indexOf(' ') + 1) : end}`;
  };

  return (
    <>
      <div className="hidden md:block">
        <Table label={ta.log.title}>
          <thead><tr><Th>{ta.log.when}</Th><Th>{ta.log.what}</Th><Th>{ta.log.user}</Th><Th>{ta.log.client}</Th><Th>{ta.log.file}</Th></tr></thead>
          <tbody>
            {entries.map((entry) => {
              const head = entryHead(entry);
              if (!head) return null;
              return (
                <tr key={entry.kind === 'event' ? head.id : `group-${head.id}`}>
                  <Td className="whitespace-nowrap align-top tabular-nums text-muted">{when(entry, head)}</Td>
                  <Td className="min-w-[14rem] align-top">{what(entry)}</Td>
                  <Td className="max-w-[14rem] truncate align-top text-muted" title={actorText(head, ta)}>{actorText(head, ta)}</Td>
                  <Td className="max-w-[12rem] truncate align-top text-muted">{client(head)}</Td>
                  <Td className="max-w-xs truncate align-top">{catalog(head)}</Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </div>
      <ul className="space-y-2 md:hidden">
        {entries.map((entry) => {
          const head = entryHead(entry);
          if (!head) return null;
          return (
            <li key={entry.kind === 'event' ? head.id : `group-${head.id}`} className="rounded-ctl border border-line bg-raised p-3">
              <p className="text-small tabular-nums text-muted">{when(entry, head)}</p>
              <div className="mt-0.5">{what(entry)}</div>
              <p className="mt-1 text-small text-muted [overflow-wrap:anywhere]">
                {actorText(head, ta)}
                {head.clientName ? <> · {client(head)}</> : null}
                {catalogText(head, ta) ? <> · {catalog(head)}</> : null}
              </p>
            </li>
          );
        })}
      </ul>
    </>
  );
}
