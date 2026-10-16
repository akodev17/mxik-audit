import type { ReactNode } from 'react';

type Props = { title: string; hint?: string; action?: ReactNode; tone?: 'neutral' | 'danger' };

/** Nothing to show, or something went wrong: say which and what to do next. */
export function EmptyState({ title, hint, action, tone = 'neutral' }: Props) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-6 py-16 text-center">
      <span aria-hidden className={`mb-4 grid size-12 place-items-center rounded-full text-xl ${tone === 'danger' ? 'bg-danger-tint text-danger' : 'bg-surface text-muted'}`}>
        {tone === 'danger' ? '!' : '∅'}
      </span>
      <h2 className="text-lg">{title}</h2>
      {hint ? <p className="mt-1 text-sm text-muted">{hint}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
