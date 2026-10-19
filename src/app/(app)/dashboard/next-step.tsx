import type { ClientStats } from '@/lib/client-stats';
import { fmtNumber } from '@/lib/format';
import { getI18n } from '@/lib/locale';
import type { OpenTask } from '@/lib/reminders';
import { ButtonLink } from '@/ui/button';
import { IconInfo, IconSuccess } from '@/ui/icons';

type Props = { clients: ClientStats[]; tasks: OpenTask[]; canUpload: boolean; queueHref: (extra?: string) => string };

/** One suggestion for what to do now: an overdue check, else the most open risk, else a client without a catalogue. */
export async function NextStep({ clients, tasks, canUpload, queueHref }: Props) {
  const { locale, ta } = await getI18n();
  const home = ta.firmX.home;
  const overdue = tasks.find((x) => x.overdue);
  const top = clients.reduce<ClientStats | null>((best, c) => (c.openRows > (best?.openRows ?? 0) ? c : best), null);
  const empty = clients.find((c) => !c.catalogId && !c.isDefault);

  let text: string;
  let action: { href: string; label: string } | null = null;
  if (overdue) {
    text = home.nextOverdue(overdue.clientName);
    action = { href: `/clients/${overdue.clientId}`, label: home.nextOverdueCta };
  } else if (top) {
    text = home.nextOpen(top.name, fmtNumber(locale, top.openRows), top.openRows);
    action = { href: queueHref(`client=${encodeURIComponent(top.id)}`), label: home.nextOpenCta };
  } else if (empty) {
    text = home.nextEmpty(empty.name);
    action = canUpload ? { href: `/upload?client=${encodeURIComponent(empty.id)}`, label: home.nextEmptyCta } : null;
  } else {
    text = home.nextDone;
  }

  const done = !overdue && !top && !empty;
  return (
    <section aria-labelledby="next-step" className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-ctl border border-line bg-surface px-4 py-3">
      <div className="flex min-w-0 items-start gap-2.5">
        <span aria-hidden className={done ? 'mt-0.5 text-good-ink' : 'mt-0.5 text-brand-ink'}>{done ? <IconSuccess size={18} /> : <IconInfo size={18} />}</span>
        <div className="min-w-0">
          <h2 id="next-step" className="text-small font-medium text-muted">{home.nextTitle}</h2>
          <p className="font-medium">{text}</p>
        </div>
      </div>
      {action ? <ButtonLink href={action.href} variant="primary">{action.label}</ButtonLink> : null}
    </section>
  );
}
