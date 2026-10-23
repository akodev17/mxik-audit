import Link from 'next/link';
import { fmtDate, fmtNumber } from '@tasnivo/i18n/format';
import { getI18n } from '@/lib/locale';
import { rowProgress } from '@/lib/pure/client-kpi';
import {
  QUEUE_FILTERS, QUEUE_SORTS, arrangeQueue, clientAttention, queueFilterCounts, workQueue, type PendingAudit, type QueueEntry, type QueueFilter, type QueueSort,
} from '@/lib/pure/work-queue';
import { cx } from '@/ui/cx';
import { ButtonLink } from '@/ui/button';
import { IconChevron, IconSuccess } from '@/ui/icons';
import { Menu } from '@/ui/menu';
import { Progress } from '@/ui/progress';
import { nameInitials } from '@/ui/shell/initials';
import { AttentionBadges } from '../clients/attention-badges';
import { Card, FOOT_LINK } from './card';
import type { DashboardClient } from './dashboard-data';

const SHOWN = 5;

/**
 * Where to work next: one row per client with something to do, most urgent first (a missed monthly
 * check, then the most open risky rows). Each row says who, which catalogue and how far the review
 * is, and has exactly one button; the first row's button is the page's primary action. Filter chips
 * and the order travel in the URL (qf, qs). The full list is /clients?filter=attention.
 */
export async function WorkQueue({ clients, pending, canUpload, queueHref, filter, sort, viewHref }: {
  clients: DashboardClient[]; pending: ReadonlyMap<string, PendingAudit>; canUpload: boolean; queueHref: (extra?: string) => string;
  filter: QueueFilter; sort: QueueSort; viewHref: (v: { qf?: QueueFilter; qs?: QueueSort }) => string;
}) {
  const { locale, ta } = await getI18n();
  const home = ta.firmX.home;
  const fmt = (n: number): string => fmtNumber(locale, n);
  const all = workQueue(clients, new Set(pending.keys()));
  const counts = queueFilterCounts(all);
  const entries = arrangeQueue(all, filter, sort);
  const shown = entries.slice(0, SHOWN);

  const act = (e: QueueEntry<DashboardClient>): { href: string; label: string } => {
    const id = encodeURIComponent(e.client.id);
    if (e.action === 'review') return { href: queueHref(`client=${id}`), label: home.nextOpenCta };
    if (e.action === 'upload' && canUpload) return { href: `/upload?client=${id}`, label: home.nextEmptyCta };
    return { href: `/clients/${e.client.id}`, label: home.nextOverdueCta };
  };

  const sortMenu = all.length > 1 ? (
    <Menu
      label={home.sortBy(home.queueSorts[sort])}
      size="sm"
      variant="ghost"
      align="end"
      items={QUEUE_SORTS.map((s) => ({ label: home.queueSorts[s], href: viewHref({ qf: filter, qs: s }), current: s === sort }))}
    />
  ) : null;

  return (
    <Card
      id="queue"
      title={home.queueTitle}
      hint={home.queueHint}
      actions={sortMenu}
      flush
      footer={entries.length > SHOWN ? (
        <Link href="/clients?filter=attention" className={FOOT_LINK}>{home.attentionAll} · {home.queueCount(fmt(entries.length))}<IconChevron size={12} /></Link>
      ) : undefined}
    >
      {all.length > 1 ? (
        <nav aria-label={home.queueFilterLabel} className="flex flex-wrap items-center gap-1.5 px-4 pb-3 sm:px-5">
          {QUEUE_FILTERS.filter((f) => f === 'all' || counts[f] > 0).map((f) => (
            <Link
              key={f} href={viewHref({ qf: f, qs: sort })} aria-current={f === filter ? 'true' : undefined} scroll={false}
              className={cx(
                'inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-small font-medium transition-colors duration-(--duration-fast)',
                f === filter ? 'border-transparent bg-fg text-inverse' : 'border-line bg-raised text-muted hover:border-line-strong hover:text-fg',
              )}
            >
              {home.queueFilters[f]}
              <span className={cx('tabular-nums', f === filter ? 'text-inverse' : 'text-subtle')}>{fmt(counts[f])}</span>
            </Link>
          ))}
        </nav>
      ) : null}

      {shown.length === 0 && all.length > 0 ? (
        <p className="border-t border-line px-5 py-8 text-center text-small text-muted">{home.queueNoMatch}</p>
      ) : shown.length === 0 ? (
        <div className="flex flex-col items-center border-t border-line px-6 py-10 text-center">
          <span aria-hidden className="mb-3 grid size-11 place-items-center rounded-full bg-good-tint text-good-ink"><IconSuccess size={20} /></span>
          <h3 className="text-data font-semibold">{home.queueDoneTitle}</h3>
          <p className="mt-1 max-w-sm text-small text-muted">{home.nextDone}</p>
          {canUpload ? <ButtonLink href="/upload" variant="secondary" size="sm" className="mt-4">{home.nextEmptyCta}</ButtonLink> : null}
        </div>
      ) : (
        <ol className="divide-y divide-line border-t border-line">
          {shown.map((e, i) => {
            const c = e.client;
            const progress = rowProgress(c);
            const action = act(e);
            const reasons = clientAttention(c, pending).filter((r) => r.kind !== 'open');
            const context = c.catalogName ? `${c.catalogName}${c.auditedAt ? ` · ${home.queueLast(fmtDate(locale, c.auditedAt))}` : ''}` : null;
            return (
              <li key={c.id} className="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3.5 transition-colors duration-(--duration-fast) hover:bg-surface/60 sm:flex-nowrap sm:px-5">
                <span aria-hidden className={cx('grid size-9 shrink-0 place-items-center rounded-md text-small font-semibold', i === 0 ? 'bg-brand-tint text-brand-ink' : 'bg-sunken text-muted')}>{nameInitials(c.name)}</span>
                <div className="min-w-0 flex-1 basis-48">
                  <div className="flex min-w-0 items-center gap-2">
                    <Link href={`/clients/${c.id}`} className="min-w-0 truncate font-medium hover:text-brand-ink hover:underline" title={c.name}>{c.name}</Link>
                    {i === 0 ? <span className="shrink-0 rounded-full bg-brand-tint px-2 py-0.5 text-micro font-medium text-brand-ink">{home.queueFirst}</span> : null}
                  </div>
                  {context ? <p className="truncate text-small text-muted" title={context}>{context}</p> : null}
                  {reasons.length > 0 ? <div className="mt-1.5"><AttentionBadges reasons={reasons} ta={ta} locale={locale} /></div> : null}
                </div>
                {progress && c.openRows > 0 ? (
                  <div className="w-full shrink-0 sm:w-48">
                    <p className="mb-1.5 text-small tabular-nums">
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
    </Card>
  );
}
