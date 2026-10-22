import Link from 'next/link';
import { clientAttention, type PendingAudit } from '@tasnivo/domain/client-attention';
import { rowProgress, type ClientStats } from '@tasnivo/domain/client-stats';
import { fmtDate, fmtNumber } from '@tasnivo/i18n/format';
import { getI18n } from '@/lib/locale';
import { QUEUE_FILTERS, QUEUE_SORTS, arrangeQueue, queueFilterCounts, workQueue, type QueueEntry, type QueueFilter, type QueueSort } from '@tasnivo/domain/work-queue';
import { cx } from '@/ui/cx';
import { ButtonLink } from '@/ui/button';
import { IconSuccess } from '@/ui/icons';
import { Progress } from '@/ui/progress';
import { AttentionBadges } from '../clients/attention-badges';

const SHOWN = 5;

/** Two-letter mark for a client tile; the name is always printed beside it. */
const initials = (name: string): string => name.replace(/[^\p{L}\p{N} ]/gu, '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || '·';

/**
 * Where to work next: one row per client with something to do, most urgent first (a missed monthly
 * check, then the most open risky rows). Each row says who, which catalogue and how far the review
 * is, and has exactly one button; the first row's button is the page's primary action. The full list
 * is /clients?filter=attention.
 */
export async function WorkQueue({ clients, pending, canUpload, queueHref, filter, sort, viewHref }: {
  clients: ClientStats[]; pending: ReadonlyMap<string, PendingAudit>; canUpload: boolean; queueHref: (extra?: string) => string;
  filter: QueueFilter; sort: QueueSort; viewHref: (v: { qf?: QueueFilter; qs?: QueueSort }) => string;
}) {
  const { locale, ta } = await getI18n();
  const home = ta.firmX.home;
  const fmt = (n: number): string => fmtNumber(locale, n);
  const all = workQueue(clients, new Set(pending.keys()));
  const counts = queueFilterCounts(all);
  const entries = arrangeQueue(all, filter, sort);
  const shown = entries.slice(0, SHOWN);

  const act = (e: QueueEntry): { href: string; label: string } => {
    const id = encodeURIComponent(e.client.id);
    if (e.action === 'review') return { href: queueHref(`client=${id}`), label: home.nextOpenCta };
    if (e.action === 'upload' && canUpload) return { href: `/upload?client=${id}`, label: home.nextEmptyCta };
    return { href: `/clients/${e.client.id}`, label: home.nextOverdueCta };
  };

  return (
    <section aria-labelledby="queue-title">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="queue-title" className="text-[1.125rem] font-medium leading-6">{home.queueTitle}</h2>
          <p className="mt-0.5 text-small text-muted">{home.queueHint}</p>
        </div>
        {entries.length > SHOWN ? <Link href="/clients?filter=attention" className="shrink-0 text-small font-medium text-brand-ink hover:underline">{home.attentionAll} ({fmt(entries.length)})</Link> : null}
      </div>

      {all.length > 1 ? (
        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-small">
          <nav aria-label={home.queueFilterLabel} className="flex flex-wrap items-center gap-1">
            {QUEUE_FILTERS.filter((f) => f === 'all' || counts[f] > 0).map((f) => (
              <Link
                key={f} href={viewHref({ qf: f, qs: sort })} aria-current={f === filter ? 'true' : undefined} scroll={false}
                className={cx('rounded-ctl px-2.5 py-1 font-medium transition-colors duration-(--duration-fast)', f === filter ? 'bg-surface text-fg' : 'text-muted hover:bg-surface hover:text-fg')}
              >
                {home.queueFilters[f]} <span className="tabular-nums text-subtle">{fmt(counts[f])}</span>
              </Link>
            ))}
          </nav>
          <nav aria-label={home.queueSortLabel} className="flex flex-wrap items-center gap-1 text-muted">
            <span>{home.queueSortLabel}:</span>
            {QUEUE_SORTS.map((s) => (
              <Link key={s} href={viewHref({ qf: filter, qs: s })} aria-current={s === sort ? 'true' : undefined} scroll={false} className={cx('rounded-ctl px-1.5 py-0.5 hover:text-fg', s === sort && 'font-medium text-fg underline underline-offset-4')}>{home.queueSorts[s]}</Link>
            ))}
          </nav>
        </div>
      ) : null}

      {shown.length === 0 && all.length > 0 ? (
        <p className="mt-4 border-y border-line py-5 text-small text-muted">{home.queueNoMatch}</p>
      ) : shown.length === 0 ? (
        <div className="mt-4 flex items-start gap-3 border-y border-line py-5">
          <span aria-hidden className="mt-0.5 text-good-ink"><IconSuccess size={20} /></span>
          <div className="min-w-0">
            <h3 className="font-medium">{home.queueDoneTitle}</h3>
            <p className="mt-0.5 text-small text-muted">{home.nextDone}</p>
            {canUpload ? <ButtonLink href="/upload" variant="secondary" size="sm" className="mt-3">{home.nextEmptyCta}</ButtonLink> : null}
          </div>
        </div>
      ) : (
        <ol className="mt-4 divide-y divide-line border-y border-line">
          {shown.map((e, i) => {
            const c = e.client;
            const progress = rowProgress(c);
            const action = act(e);
            const reasons = clientAttention(c, pending).filter((r) => r.kind !== 'open');
            const context = c.catalogName ? `${c.catalogName}${c.auditedAt ? ` · ${home.queueLast(fmtDate(locale, c.auditedAt))}` : ''}` : null;
            return (
              <li key={c.id} className="flex flex-wrap items-center gap-x-4 gap-y-3 py-4 sm:flex-nowrap">
                <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-ctl border border-line bg-surface text-small font-medium text-muted">{initials(c.name)}</span>
                <div className="min-w-0 flex-1 basis-48">
                  {i === 0 ? <p className="text-micro font-medium uppercase tracking-wide text-brand-ink">{home.queueFirst}</p> : null}
                  <Link href={`/clients/${c.id}`} className="block truncate font-medium hover:text-brand-ink hover:underline" title={c.name}>{c.name}</Link>
                  {context ? <p className="truncate text-small text-muted" title={context}>{context}</p> : null}
                  {reasons.length > 0 ? <div className="mt-1.5"><AttentionBadges reasons={reasons} ta={ta} locale={locale} /></div> : null}
                </div>
                {progress && c.openRows > 0 ? (
                  <div className="w-full shrink-0 sm:w-56">
                    <p className="mb-1 flex items-baseline justify-between gap-2 text-small tabular-nums">
                      <span className="font-medium text-danger-ink">{home.queueOpenOf(fmt(c.openRows), fmt(progress.total), progress.total)}</span>
                    </p>
                    <Progress size="sm" tone="good" hideLabel label={ta.firmX.progress.label} value={progress.done} max={progress.total}
                      valueText={ta.firmX.progress.of(fmt(progress.done), fmt(progress.total), progress.total)} />
                  </div>
                ) : null}
                <ButtonLink href={action.href} variant={i === 0 ? 'primary' : 'secondary'} size="sm" className="shrink-0 max-sm:w-full">{action.label}</ButtonLink>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
