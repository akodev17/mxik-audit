import { getI18n } from '@/lib/locale';
import type { Step } from '@tasnivo/domain/onboarding';
import { ButtonLink } from '@/ui/button';
import { cx } from '@/ui/cx';
import { IconCheck, IconChevronDown } from '@/ui/icons';
import { Progress } from '@/ui/progress';

/**
 * First-run checklist: done steps ticked, the first open step is the page's primary action.
 * Once work has started (primary false) it folds into one line near the top of the dashboard.
 */
export async function Onboarding({ steps, primary }: { steps: Step[]; primary: boolean }) {
  const { ta } = await getI18n();
  const words = ta.firmX.onboarding;
  const done = steps.filter((s) => s.done).length;
  const next = steps.find((s) => !s.done);
  const progress = words.progress(done, steps.length);

  const head = (
    <>
      <div className="min-w-0">
        <h2 id="onboarding-title" className="text-section">{words.title}</h2>
        <p className="mt-0.5 text-small text-muted">{primary ? words.hint : progress}</p>
      </div>
      <Progress className="w-48 max-w-full" label={words.title} hideLabel value={done} max={steps.length} valueText={progress} size="sm" />
    </>
  );
  const list = (
    <ol className="mt-4 divide-y divide-line">
      {steps.map((s) => {
        const step = words.steps[s.key];
        const isNext = next?.key === s.key;
        return (
          // On a phone the button goes under the text, so the title keeps the full width.
          <li key={s.key} className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-2 py-3 sm:flex sm:items-center">
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
              <ButtonLink href={s.href} size="sm" variant={isNext && primary ? 'primary' : 'secondary'} className="col-start-2 justify-self-start sm:shrink-0">
                {step.cta}
              </ButtonLink>
            )}
          </li>
        );
      })}
    </ol>
  );

  if (!primary) {
    return (
      <details aria-labelledby="onboarding-title" className="group rounded-lg border border-line bg-raised">
        <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3 p-4 sm:px-5 [&::-webkit-details-marker]:hidden">
          {head}
          <IconChevronDown size={16} className="shrink-0 text-muted transition-transform duration-(--duration-fast) group-open:rotate-180" />
        </summary>
        <div className="border-t border-line px-4 pb-2 sm:px-5">
          <p className="mt-3 text-small text-muted">{words.hint}</p>
          {list}
        </div>
      </details>
    );
  }

  return (
    <section aria-labelledby="onboarding-title" className="rounded-lg border border-line bg-raised p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">{head}</div>
      <p className="mt-1 text-small text-muted" aria-hidden>{progress}</p>
      {list}
    </section>
  );
}
