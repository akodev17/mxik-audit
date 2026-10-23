'use client';

import { useI18n } from '@/lib/locale-client';
import { cx } from '@/ui/cx';
import { IconCheck } from '@/ui/icons';
import { VisuallyHidden } from '@/ui/visually-hidden';

type State = 'done' | 'current' | 'upcoming';

const CIRCLE: Record<State, string> = {
  done: 'bg-good text-on-fill',
  current: 'bg-brand text-on-fill ring-4 ring-brand-tint',
  upcoming: 'border border-line-strong bg-raised text-muted',
};

const LABEL: Record<State, string> = { done: 'text-fg', current: 'font-semibold text-fg', upcoming: 'text-muted' };

/**
 * The upload wizard's stages: done, current and upcoming, each said in text as well as colour.
 * On a phone only the current stage is named ("Step 3 of 6") over a segmented bar; the full list
 * stays for screen readers.
 */
export function WizardStepper({ steps, current }: { steps: readonly string[]; current: number }) {
  const { ta } = useI18n();
  const f = ta.importX.flow;
  const stateOf = (i: number): State => (i < current ? 'done' : i === current ? 'current' : 'upcoming');

  return (
    <div className="relative">
      <div aria-hidden className="sm:hidden">
        <p className="flex items-baseline justify-between gap-3 text-small">
          <span className="min-w-0 truncate font-semibold text-fg">{steps[current]}</span>
          <span className="shrink-0 tabular-nums text-muted">{f.stepOf(current + 1, steps.length)}</span>
        </p>
        <div className="mt-2 flex gap-1">
          {steps.map((label, i) => (
            <span
              key={label}
              className={cx('h-1.5 flex-1 rounded-full', i < current ? 'bg-good' : i === current ? 'bg-brand' : 'bg-sunken inset-ring inset-ring-line-strong')}
            />
          ))}
        </div>
      </div>

      <ol aria-label={ta.shell.steps} className="flex items-start max-sm:sr-only">
        {steps.map((label, i) => {
          const state = stateOf(i);
          return (
            <li key={label} aria-current={state === 'current' ? 'step' : undefined} className="relative flex min-w-0 flex-1 flex-col items-center gap-2 text-center">
              {/* From the previous stage's circle to this one, edge to edge: green once this stage is reached. */}
              {i > 0 ? (
                <span aria-hidden className={cx('absolute top-3.5 right-[calc(50%+1.25rem)] left-[calc(-50%+1.25rem)] h-0.5 -translate-y-1/2 rounded-full', i <= current ? 'bg-good' : 'bg-line-strong')} />
              ) : null}
              <span className={cx('relative grid size-7 place-items-center rounded-full text-small font-semibold tabular-nums transition-colors duration-(--duration-base)', CIRCLE[state])}>
                {state === 'done' ? <IconCheck size={14} /> : i + 1}
              </span>
              <span className={cx('max-w-full truncate px-1 text-small', LABEL[state])}>
                {label}<VisuallyHidden>, {f.stepState[state]}</VisuallyHidden>
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
