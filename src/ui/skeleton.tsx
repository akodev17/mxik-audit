import { cx } from './cx';

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cx('skeleton rounded-ctl', className)} />;
}

/** Placeholder for a page while its server data loads. */
export function PageSkeleton() {
  return (
    <div className="p-6" aria-busy="true">
      <Skeleton className="h-7 w-64" />
      <Skeleton className="mt-3 h-4 w-96 max-w-full" />
      <div className="mt-8 space-y-2">
        {Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-10 w-full" />)}
      </div>
    </div>
  );
}
