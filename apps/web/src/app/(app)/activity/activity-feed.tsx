import Link from 'next/link';
import type { ActivityEntry } from '@tasnivo/domain/activity-groups';
import { fmtDateTime } from '@tasnivo/i18n/format';
import { getI18n } from '@/lib/locale';
import { RowList } from '@/ui/row-list';
import { actorText, catalogText, entryHead, entryTitle } from './entry-text';

/** Compact list of log entries for the dashboard and the client page; the full log is /activity. */
export async function ActivityFeed({ entries, showClient = true }: { entries: ActivityEntry[]; showClient?: boolean }) {
  const { locale, ta } = await getI18n();
  return (
    <RowList>
      {entries.map((entry) => {
        const head = entryHead(entry);
        if (!head) return null;
        const catalog = entry.kind === 'event' ? catalogText(head, ta) : null;
        return (
          <li key={entry.kind === 'event' ? head.id : `group-${head.id}`} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-2.5">
            <span className="min-w-0">
              <span className="block font-medium">
                {entry.kind === 'group' && head.catalogId
                  ? <Link href={`/catalogs/${head.catalogId}`} className="hover:text-brand-ink hover:underline">{entryTitle(entry, ta, locale)}</Link>
                  : entryTitle(entry, ta, locale)}
              </span>
              <span className="block text-small text-muted">
                {actorText(head, ta)}
                {showClient && head.clientName ? <> · {head.clientId ? <Link href={`/clients/${head.clientId}`} className="hover:text-fg hover:underline">{head.clientName}</Link> : head.clientName}</> : null}
                {catalog ? <> · {head.catalogId ? <Link href={`/catalogs/${head.catalogId}`} className="hover:text-fg hover:underline">{catalog}</Link> : catalog}</> : null}
              </span>
            </span>
            <time dateTime={head.at.toISOString()} className="shrink-0 text-small tabular-nums text-muted">{fmtDateTime(locale, head.at)}</time>
          </li>
        );
      })}
    </RowList>
  );
}
