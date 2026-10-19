import { getI18n } from '@/lib/locale';
import type { Step } from '@/lib/onboarding';
import { ButtonLink } from '@/ui/button';
import { cx } from '@/ui/cx';
import { IconCheck } from '@/ui/icons';
import { Progress } from '@/ui/progress';

/** First-run checklist: done steps ticked, the first open step is the page's primary action. */
export async function Onboarding({ steps, primary }: { steps: Step[]; primary: boolean }) {
  const { ta } = await getI18n();
  const words = ta.firmX.onboarding;
  const done = steps.filter((s) => s.done).length;
  const next = steps.find((s) => !s.done);
  return (
    <section aria-labelledby="onboarding-title" className="rounded-lg border border-line bg-raised p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="onboarding-title" className="text-section">{words.title}</h2>
          <p className="mt-0.5 text-small text-muted">{words.hint}</p>
        </div>
        <Progress className="w-48 max-w-full" label={words.title} hideLabel value={done} max={steps.length} valueText={words.progress(done, steps.length)} size="sm" />
      </div>
      <p className="mt-1 text-small text-muted" aria-hidden>{words.progress(done, steps.length)}</p>
      <ol className="mt-4 divide-y divide-line">
        {steps.map((s) => {
          const step = words.steps[s.key];
          const isNext = next?.key === s.key;
          return (
            <li key={s.key} className="flex flex-wrap items-center gap-3 py-3">
              <span
                aria-hidden
                className={cx('grid size-6 shrink-0 place-items-center rounded-full border', s.done ? 'border-good bg-good text-on-fill' : 'border-line-strong text-transparent')}
              >
                <IconCheck size={14} />
              </span>
              <span className="min-w-0 flex-1">
                <span className={cx('block font-medium', s.done && 'text-muted line-through decoration-line-strong')}>{step.label}</span>
                {s.done ? <span className="sr-only">{words.done}</span> : <span className="block text-small text-muted">{step.hint}</span>}
              </span>
              {s.done ? null : (
                <ButtonLink href={s.href} size="sm" variant={isNext && primary ? 'primary' : 'secondary'}>{step.cta}</ButtonLink>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
