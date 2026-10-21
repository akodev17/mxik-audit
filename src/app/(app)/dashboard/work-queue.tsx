import Link from 'next/link';
import { clientAttention, type PendingAudit } from '@/lib/client-attention';
import { rowProgress, type ClientStats } from '@/lib/client-stats';
import { fmtNumber } from '@/lib/format';
import { getI18n } from '@/lib/locale';
import { workQueue, type QueueEntry } from '@/lib/work-queue';
import { ButtonLink } from '@/ui/button';
import { IconSuccess } from '@/ui/icons';
import { Progress } from '@/ui/progress';
import { AttentionBadges } from '../clients/attention-badges';

const SHOWN = 5;

/** Two-letter mark for a client tile; the name is always printed beside it. */
const initials = (name: string): string => name.replace(/[^\p{L}\p{N} ]/gu, '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || '·';

/**
 * Where to work next, as a list of actions: one row per client with something to do, most urgent
 * first (a missed monthly check, then the most open risky rows), each with one button. The first
 * row's button is the primary action of the page. The full list is /clients?filter=attention.
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
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="queue-title" className="text-[1.125rem] font-medium leading-6">{home.queueTitle}</h2>
          <p className="mt-0.5 text-small text-muted">{home.queueHint}</p>
        </div>
        {entries.length > SHOWN ? <Link href="/clients?filter=attention" className="shrink-0 text-small font-medium text-brand-ink hover:underline">{home.attentionAll} ({fmt(entries.length)})</Link> : null}
      </div>

      {shown.length === 0 ? (
        <div className="mt-5 flex items-start gap-3 rounded-ctl border border-line bg-surface p-4">
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
            return (
              <li key={c.id} className="flex items-center gap-3 py-3">
                <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-ctl border border-line bg-surface text-small font-medium text-muted">{initials(c.name)}</span>
                <div className="min-w-0 flex-1">
                  <Link href={`/clients/${c.id}`} className="block truncate font-medium hover:text-brand-ink hover:underline" title={c.name}>{c.name}</Link>
                  {progress && c.openRows > 0 ? (
                    <>
                      <p className="text-small tabular-nums text-danger-ink">{home.queueOpenOf(fmt(c.openRows), fmt(progress.total), progress.total)}</p>
                      <Progress className="mt-1" size="sm" tone="good" hideLabel label={ta.firmX.progress.label} value={progress.done} max={progress.total} />
                    </>
                  ) : null}
                  {reasons.length > 0 ? <div className="mt-1"><AttentionBadges reasons={reasons} ta={ta} locale={locale} /></div> : null}
                </div>
                <ButtonLink href={action.href} variant={i === 0 ? 'primary' : 'secondary'} size="sm" className="shrink-0">{action.label}</ButtonLink>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
