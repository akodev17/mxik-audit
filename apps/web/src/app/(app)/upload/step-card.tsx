import type { ReactNode } from 'react';
import { cx } from '@/ui/cx';

type Props = {
  titleId: string;
  title: string;
  hint?: string;
  /** Next to the title (a status, a count). */
  aside?: ReactNode;
  /** Sits left of the title (a status icon). */
  icon?: ReactNode;
  className?: string;
  children: ReactNode;
};

/** One wizard step: a raised card with its h2, so every step reads as the same flow. */
export function StepCard({ titleId, title, hint, aside, icon, className, children }: Props) {
  return (
    <section aria-labelledby={titleId} className={cx('relative space-y-5 rounded-lg border border-line bg-raised p-4 sm:p-6', className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          {icon}
          <div className="min-w-0">
            <h2 id={titleId} className="text-section">{title}</h2>
            {hint ? <p className="mt-0.5 max-w-2xl text-small text-muted">{hint}</p> : null}
          </div>
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** The step's buttons: back on the left (ghost), the one primary action last. */
export function StepFooter({ children }: { children: ReactNode }) {
  return (
    <div className="-mx-4 -mb-4 flex flex-wrap items-center justify-end gap-2 border-t border-line px-4 py-3 sm:-mx-6 sm:-mb-6 sm:px-6 sm:py-4">
      {children}
    </div>
  );
}
