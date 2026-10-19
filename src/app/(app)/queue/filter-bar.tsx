import type { ReactNode } from 'react';
import { getI18n } from '@/lib/locale';
import { Button, ButtonLink } from '@/ui/button';
import { cx } from '@/ui/cx';

/** Wrapper class for a filter field: a one-line label, so every control starts at the same height. */
export const FILTER_FIELD = 'min-w-0 [&>label]:truncate';

type Props = {
  action: string;
  /** Where "clear" leads; omitted while no filter is set. */
  reset?: string | null;
  /** Grid template for the fields; by default they share the row equally. */
  fieldsClassName?: string;
  /** Few fields: they keep their own width and the buttons follow them instead of the row's end. */
  compact?: boolean;
  children: ReactNode;
};

/**
 * One filter bar for the firm pages (queue, log, clients, catalogues): a GET form, a secondary
 * "Apply" and a ghost "Clear" side by side at the end of the row, never wrapping under each other.
 */
export async function FilterBar({ action, reset, fieldsClassName, compact = false, children }: Props) {
  const { ta } = await getI18n();
  const words = ta.firmX.filterBar;
  return (
    <form action={action} className={cx('mb-5 flex flex-col gap-3', compact ? 'sm:flex-row sm:items-end' : 'lg:flex-row lg:items-end')}>
      <div className={cx('grid min-w-0 items-start gap-3', !compact && 'flex-1', fieldsClassName ?? 'grid-cols-2 lg:grid-cols-[repeat(auto-fit,minmax(11rem,1fr))]')}>
        {children}
      </div>
      <div className="flex shrink-0 flex-nowrap items-center gap-2">
        <Button type="submit" variant="secondary">{words.apply}</Button>
        {reset ? <ButtonLink href={reset} variant="ghost">{words.reset}</ButtonLink> : null}
      </div>
    </form>
  );
}
