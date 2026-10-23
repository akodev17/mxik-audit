'use client';

import { useI18n } from '@/lib/locale-client';
import { cx } from './cx';
import { IconCheck } from './icons';

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
              'grid size-6 shrink-0 place-items-center rounded-full text-micro font-semibold',
              done ? 'bg-good text-on-fill' : active ? 'bg-brand text-on-fill ring-4 ring-brand-tint' : 'border border-line-strong bg-raised text-muted',
            )}>
              {done ? <IconCheck size={14} /> : i + 1}
            </span>
            <span className={cx('text-data', active ? 'font-semibold text-fg' : done ? 'text-fg' : 'text-muted')}>{label}</span>
            {i < stages.length - 1 ? <span aria-hidden className={cx('mx-1 h-px w-8', done ? 'bg-good' : 'bg-line-strong')} /> : null}
          </li>
        );
      })}
    </ol>
  );
}
