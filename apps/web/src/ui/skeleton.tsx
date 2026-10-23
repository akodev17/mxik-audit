import { cx } from './cx';

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cx('skeleton rounded-ctl', className)} />;
}

type LineSize = 'title' | 'section' | 'body' | 'data' | 'small';

// The box keeps the line height of the text it stands for, the bar inside is about its x-height:
// nothing moves when the real text arrives.
const LINE_BOX: Record<LineSize, string> = { title: 'h-8', section: 'h-7', body: 'h-5', data: 'h-4.5', small: 'h-4' };
const LINE_BAR: Record<LineSize, string> = { title: 'h-5', section: 'h-4', body: 'h-3', data: 'h-2.5', small: 'h-2.5' };

/** One line of text at a type-scale size. `width` is a width utility (w-40, w-3/5). */
export function SkeletonLine({ size = 'body', width = 'w-full', className }: { size?: LineSize; width?: string; className?: string }) {
  return (
    <div aria-hidden className={cx('flex items-center', LINE_BOX[size], width, className)}>
      <div className={cx('skeleton w-full rounded-sm', LINE_BAR[size])} />
    </div>
  );
}

/** A paragraph of `lines` lines; the last one is shorter. */
export function SkeletonText({ lines = 3, size = 'body', className }: { lines?: number; size?: 'body' | 'data' | 'small'; className?: string }) {
  return (
    <div aria-hidden className={className}>
      {Array.from({ length: lines }, (_, i) => <SkeletonLine key={i} size={size} width={i === lines - 1 && lines > 1 ? 'w-3/5' : 'w-full'} />)}
    </div>
  );
}

/** A card placeholder on the Card surface and padding: a title line and a short paragraph. */
export function SkeletonCard({ lines = 2, className }: { lines?: number; className?: string }) {
  return (
    <div aria-hidden className={cx('rounded-lg border border-line bg-raised p-5', className)}>
      <SkeletonLine size="section" width="w-2/5" />
      <SkeletonText lines={lines} className="mt-3" />
    </div>
  );
}

/** Placeholder for a page while its server data loads. The navigation watchdog looks for its marker (src/ui/shell/same-route-links.ts). */
export function PageSkeleton() {
  return (
    <div className="p-6" aria-busy="true" data-page-skeleton="">
      <Skeleton className="h-7 w-64" />
      <Skeleton className="mt-3 h-4 w-96 max-w-full" />
      <div className="mt-8 space-y-2">
        {Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-10 w-full" />)}
      </div>
    </div>
  );
}
