import Link from 'next/link';
import { getI18n } from '@/lib/locale';
import { ButtonLink } from '@/ui/button';
import { cx } from '@/ui/cx';
import { IconCheck, IconChevron } from '@/ui/icons';
import { Progress } from '@/ui/progress';
import type { Step } from './dashboard-data';
import { DismissibleOnboarding } from './onboarding-toggle';

/**
 * The "getting started" checklist. On a firm's first visits (nothing uploaded yet) it leads the page: every
 * step with its hint and button, the first open step being the page's primary action. Once work has started
 * it is a small card beside the work, with the open steps as links, and it can be closed.
 */
export async function Onboarding({ steps, primary }: { steps: Step[]; primary: boolean }) {
  const { ta } = await getI18n();
  const words = ta.firmX.onboarding;
  const done = steps.filter((s) => s.done).length;
  const next = steps.find((s) => !s.done);
  const progress = words.progress(done, steps.length);
  const bar = <Progress className="w-full" label={words.title} hideLabel value={done} max={steps.length} valueText={progress} size="sm" tone="good" />;

  if (primary) {
    return (
      <section aria-labelledby="onboarding-title" className="rounded-lg border border-line bg-raised">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b border-line px-4 py-4 sm:px-5">
          <div className="min-w-0">
            <h2 id="onboarding-title" className="text-section">{words.title}</h2>
            <p className="mt-0.5 text-small text-muted">{words.hint}</p>
          </div>
          <div className="w-full sm:w-56">
            <p className="mb-1.5 text-right text-small font-medium tabular-nums text-muted">{progress}</p>
            {bar}
          </div>
        </div>
        <ol className="divide-y divide-line">
          {steps.map((s, i) => {
            const step = words.steps[s.key];
            const isNext = next?.key === s.key;
            return (
              // On a phone the button goes under the text, so the title keeps the full width.
              <li key={s.key} className={cx('grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3.5 gap-y-2.5 px-4 py-3.5 sm:flex sm:items-center sm:px-5', isNext && 'bg-brand-tint/40')}>
                <span
                  aria-hidden
                  className={cx(
                    'grid size-7 shrink-0 place-items-center rounded-full text-small font-semibold tabular-nums',
                    s.done ? 'bg-good text-on-fill' : isNext ? 'bg-brand text-on-fill' : 'border border-line-strong text-muted',
                  )}
                >
                  {s.done ? <IconCheck size={14} /> : i + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={cx('block font-medium', s.done && 'text-muted line-through decoration-line-strong')}>{step.label}</span>
                  {s.done ? <span className="sr-only">{words.done}</span> : <span className="block text-small text-muted">{step.hint}</span>}
                </span>
                {s.done ? null : (
                  <ButtonLink href={s.href} size="sm" variant={isNext ? 'primary' : 'secondary'} className="col-start-2 justify-self-start sm:shrink-0">
                    {step.cta}
                  </ButtonLink>
                )}
              </li>
            );
          })}
        </ol>
      </section>
    );
  }

  return (
    <DismissibleOnboarding label={words.dismiss}>
      <section aria-labelledby="onboarding-title" className="rounded-lg border border-line bg-raised">
        <div className="px-4 pb-3 pr-12 pt-4 sm:px-5 sm:pr-12">
          <h2 id="onboarding-title" className="text-section">{words.title}</h2>
          <p className="mt-0.5 text-small tabular-nums text-muted">{progress}</p>
          <div className="mt-3">{bar}</div>
        </div>
        <ol className="border-t border-line px-2 py-2">
          {steps.map((s) => {
            const step = words.steps[s.key];
            return (
              <li key={s.key}>
                {s.done ? (
                  <span className="flex items-center gap-2.5 rounded-ctl px-2.5 py-1.5 text-small text-muted">
                    <span aria-hidden className="grid size-5 shrink-0 place-items-center rounded-full bg-good text-on-fill"><IconCheck size={12} /></span>
                    <span className="min-w-0 flex-1 truncate line-through decoration-line-strong">{step.label}</span>
                    <span className="sr-only">{words.done}</span>
                  </span>
                ) : (
                  <Link href={s.href} className="group/step flex items-center gap-2.5 rounded-ctl px-2.5 py-1.5 text-small font-medium text-fg hover:bg-surface">
                    <span aria-hidden className={cx('size-5 shrink-0 rounded-full border-2', next?.key === s.key ? 'border-brand' : 'border-line-strong')} />
                    <span className="min-w-0 flex-1 truncate" title={step.hint}>{step.label}</span>
                    <IconChevron size={12} className="shrink-0 text-subtle transition-transform duration-(--duration-fast) group-hover/step:translate-x-0.5" />
                  </Link>
                )}
              </li>
            );
          })}
        </ol>
      </section>
    </DismissibleOnboarding>
  );
}
