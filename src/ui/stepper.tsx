'use client';

import { useI18n } from '@/lib/locale-client';
import { cx } from './cx';

/** Horizontal stages; everything before `current` is done. */
export function Stepper({ stages, current }: { stages: readonly string[]; current: number }) {
  const { ta } = useI18n();
  return (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-2" aria-label={ta.shell.steps}>
      {stages.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={label} className="flex items-center gap-2" aria-current={active ? 'step' : undefined}>
            <span className={cx(
              'grid size-6 place-items-center rounded-full text-xs font-bold',
              done ? 'bg-good text-white' : active ? 'bg-brand text-white' : 'bg-surface text-muted',
            )}>
              {done ? '✓' : i + 1}
            </span>
            <span className={cx('text-sm', active ? 'font-bold' : done ? 'text-fg' : 'text-muted')}>{label}</span>
            {i < stages.length - 1 ? <span aria-hidden className="mx-1 h-px w-6 bg-line-strong" /> : null}
          </li>
        );
      })}
    </ol>
  );
}
