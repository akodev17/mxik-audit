import Link from 'next/link';
import { fmtNumber } from '@tasnivo/i18n/format';
import { getI18n } from '@/lib/locale';
import { cx } from '@/ui/cx';
import { IconChevron } from '@/ui/icons';
import { TRACK_CLASS } from '@/ui/progress';
import { withQuery } from './queue-params';

type ByClient = { clientId: string; name: string; findings: number; rows: number };

type Props = {
  byClient: ByClient[];
  /** This page's rows: a client with a row here gets a link straight to that catalogue. */
  rows: { clientId: string; catalogId: string; catalogName: string }[];
  /** Findings in the whole filtered queue, for each client's share. */
  total: number;
  filters: Record<string, string | undefined>;
  current: string | null;
};

/**
 * The queue per client: pending findings and rows, the client's share of the queue as a bar, and
 * two ways in (the queue filtered to the client, or the client's catalogue in the workspace).
 * The chosen client is outlined; choosing it again shows every client.
 */
export async function ClientCards({ byClient, rows, total, filters, current }: Props) {
  const { ta, locale } = await getI18n();
  const q = ta.firmX.queue;
  const u = ta.wsUi.queue;
  const fmt = (n: number): string => fmtNumber(locale, n);
  const catalogOf = new Map<string, { id: string; name: string }>();
  for (const r of rows) if (!catalogOf.has(r.clientId)) catalogOf.set(r.clientId, { id: r.catalogId, name: r.catalogName });

  return (
    <section aria-label={q.byClient} className="mb-6">
      <h2 className="mb-2 text-small font-medium text-muted">{u.clients}</h2>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {byClient.map((c) => {
          const on = current === c.clientId;
          const share = total > 0 ? Math.round((c.findings / total) * 100) : 0;
          const catalog = catalogOf.get(c.clientId);
          return (
            <li key={c.clientId} className={cx('flex flex-col gap-3 rounded-lg border bg-raised p-4', on ? 'border-brand shadow-[inset_0_0_0_1px_var(--color-brand)]' : 'border-line')}>
              <div className="flex items-start justify-between gap-3">
                <Link href={`/clients/${c.clientId}`} className="min-w-0 truncate font-medium text-fg hover:text-brand-ink hover:underline" title={c.name}>{c.name}</Link>
                <span className="shrink-0 text-micro tabular-nums text-muted">{u.share(fmt(share))}</span>
              </div>
              <p className="flex items-baseline gap-3">
                <span className="text-title tabular-nums text-fg">{fmt(c.findings)}</span>
                <span className="text-small text-muted">{u.findingsUnit(c.findings)} · {u.rows(fmt(c.rows), c.rows)}</span>
              </p>
              <span aria-hidden className={cx('block h-1.5 overflow-hidden rounded-full', TRACK_CLASS)}>
                <span className="block h-full rounded-full bg-brand" style={{ width: `${Math.max(2, share)}%` }} />
              </span>
              <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1 text-small">
                <Link
                  href={withQuery('/queue', filters, { client: on ? null : c.clientId, after: null })}
                  aria-current={on ? 'true' : undefined}
                  className="font-medium text-brand-ink hover:underline"
                >
                  {on ? q.allClients : u.showClient(c.name)}
                </Link>
                {catalog ? (
                  <Link href={`/catalogs/${catalog.id}`} className="inline-flex items-center gap-0.5 font-medium text-fg hover:text-brand-ink hover:underline" title={catalog.name}>
                    {u.open}<IconChevron size={14} />
                  </Link>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
