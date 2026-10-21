import Link from 'next/link';
import { clientAttention, type PendingAudit } from '@/lib/client-attention';
import { rowProgress } from '@/lib/client-stats';
import { fmtDate, fmtNumber } from '@/lib/format';
import { getI18n } from '@/lib/locale';
import { workQueue, type QueueEntry } from '@/lib/work-queue';
import type { ClientStats } from '@/lib/client-stats';
import { ButtonLink } from '@/ui/button';
import { cx } from '@/ui/cx';
import { IconSuccess } from '@/ui/icons';
import { Progress } from '@/ui/progress';
import { AttentionBadges } from '../clients/attention-badges';

const SHOWN = 6;

/**
 * Where to work next: clients with something to do, most urgent first (a missed monthly check,
 * then the most open risky rows). The first row is the next task and carries the primary action;
 * every row has exactly one action. The full list lives at /clients?filter=attention.
 */
export async function WorkQueue({ clients, pending, canUpload, queueHref }: {
  clients: ClientStats[]; pending: ReadonlyMap<string, PendingAudit>; canUpload: boolean; queueHref: (extra?: string) => string;
}) {
  const { locale, ta } = await getI18n();
  const home = ta.firmX.home;
  const fmt = (n: number): string => fmtNumber(locale, n);
  const entries = workQueue(clients, new Set(pending.keys()));
  const shown = entries.slice(0, SHOWN);

  const act = (e: QueueEntry): { href: string; label: string } => {
    const id = encodeURIComponent(e.client.id);
    if (e.action === 'review') return { href: queueHref(`client=${id}`), label: home.nextOpenCta };
    if (e.action === 'upload' && canUpload) return { href: `/upload?client=${id}`, label: home.nextEmptyCta };
    return { href: `/clients/${e.client.id}`, label: home.nextOverdueCta };
  };

  return (
    <section aria-labelledby="queue-title">
      <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-1">
        <div className="min-w-0">
          <h2 id="queue-title" className="text-section">{home.queueTitle}</h2>
          <p className="mt-0.5 max-w-xl text-small text-muted">{home.queueHint}</p>
        </div>
        {entries.length > SHOWN ? <Link href="/clients?filter=attention" className="text-small font-medium text-brand-ink hover:underline">{home.attentionAll} ({fmt(entries.length)})</Link> : null}
      </div>

      {shown.length === 0 ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-ctl border border-line bg-raised px-4 py-4">
          <div className="flex min-w-0 items-start gap-2.5">
            <span aria-hidden className="mt-0.5 text-good-ink"><IconSuccess size={20} /></span>
            <div className="min-w-0">
              <h3 className="font-medium">{home.queueDoneTitle}</h3>
              <p className="mt-0.5 text-small text-muted">{home.nextDone}</p>
            </div>
          </div>
          {canUpload ? <ButtonLink href="/upload" variant="secondary">{home.nextEmptyCta}</ButtonLink> : null}
        </div>
      ) : (
        <ol className="@container mt-3 divide-y divide-line overflow-hidden rounded-ctl border border-line bg-raised">
          {shown.map((e, i) => {
            const c = e.client;
            const progress = rowProgress(c);
            const action = act(e);
            const reasons = clientAttention(c, pending).filter((r) => r.kind !== 'open');
            const first = i === 0;
            return (
              <li key={c.id} className={cx('relative grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-5 gap-y-3 px-4 py-3.5 @2xl:grid-cols-[minmax(0,1fr)_minmax(0,13rem)_auto]', first && 'bg-surface')}>
                {first ? <span aria-hidden className="absolute inset-y-0 left-0 w-[3px] bg-brand" /> : null}
                <div className="min-w-0">
                  {first ? <p className="mb-0.5 text-micro font-medium uppercase tracking-wide text-brand-ink">{home.queueFirst}</p> : null}
                  <Link href={`/clients/${c.id}`} className="font-medium [overflow-wrap:anywhere] hover:text-brand-ink hover:underline">{c.name}</Link>
                  {c.catalogId && c.catalogName ? (
                    <p className="mt-0.5 truncate text-small text-muted" title={c.catalogName}>
                      <Link href={`/catalogs/${c.catalogId}`} className="hover:underline">{c.catalogName}</Link>
                      {c.auditedAt ? <> · {home.queueLast(fmtDate(locale, c.auditedAt))}</> : null}
                    </p>
                  ) : null}
                  {reasons.length > 0 ? <div className="mt-1.5"><AttentionBadges reasons={reasons} ta={ta} locale={locale} /></div> : null}
                </div>
                <div className={cx(progress && c.openRows > 0 ? 'order-3 col-span-2 @2xl:order-none @2xl:col-span-1' : 'hidden @2xl:block', 'min-w-0')}>
                  {progress && c.openRows > 0 ? (
                    <>
                      <p className="mb-1 text-small font-medium tabular-nums text-danger-ink">{home.queueOpenOf(fmt(c.openRows), fmt(progress.total), progress.total)}</p>
                      <Progress size="sm" tone="good" hideLabel label={ta.firmX.progress.label} value={progress.done} max={progress.total}
                        valueText={ta.firmX.progress.of(fmt(progress.done), fmt(progress.total), progress.total)} />
                    </>
                  ) : null}
                </div>
                <div className="justify-self-end">
                  <ButtonLink href={action.href} variant={first ? 'primary' : 'secondary'} size={first ? 'md' : 'sm'}>{action.label}</ButtonLink>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
