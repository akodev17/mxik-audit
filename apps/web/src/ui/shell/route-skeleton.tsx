'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { useI18n } from '@/lib/locale-client';
import { cx } from '../cx';
import { pageContainerClass } from '../page';
import { Skeleton } from '../skeleton';
import { skeletonKind, type SkeletonKind } from './skeleton-kind';

const CARD = 'rounded-lg border border-line bg-raised';

function Head({ actions = false }: { actions?: boolean }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <Skeleton className="h-7 w-56 max-w-full" />
        <Skeleton className="mt-2.5 h-4 w-80 max-w-full" />
      </div>
      {actions ? <Skeleton className="h-9 w-36" /> : null}
    </div>
  );
}

function Rows({ n, dense = false }: { n: number; dense?: boolean }) {
  return (
    <div className={cx(CARD, 'overflow-hidden')}>
      <div className="flex gap-4 border-b border-line bg-surface px-4 py-3">
        {['w-[28%]', 'w-[18%]', 'w-[14%]', 'w-[12%]'].map((w) => <Skeleton key={w} className={cx('h-3.5', w)} />)}
      </div>
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className={cx('flex items-center gap-4 border-b border-line px-4 last:border-b-0', dense ? 'h-9' : 'h-12')}>
          <Skeleton className="h-3.5 w-[28%]" />
          <Skeleton className="h-3.5 w-[18%]" />
          <Skeleton className="h-3.5 w-[14%]" />
          <Skeleton className="ml-auto h-3.5 w-[10%]" />
        </div>
      ))}
    </div>
  );
}

function Chips() {
  return <div className="mb-4 flex flex-wrap gap-2">{['w-20', 'w-24', 'w-[4.5rem]', 'w-[5.5rem]'].map((w) => <Skeleton key={w} className={cx('h-8 rounded-full', w)} />)}</div>;
}

const BODY: Record<SkeletonKind, () => ReactNode> = {
  dashboard: () => (
    <>
      <Head actions />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className={cx(CARD, 'p-5')}>
            <Skeleton className="h-4 w-28" />
            <Skeleton className="mt-4 h-8 w-20" />
            <Skeleton className="mt-3 h-3 w-32 max-w-full" />
          </div>
        ))}
      </div>
      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className={cx(CARD, 'p-5')}>
          <Skeleton className="h-5 w-40" />
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="mt-5 flex items-center gap-4">
              <Skeleton className="size-9 shrink-0" />
              <div className="min-w-0 flex-1"><Skeleton className="h-4 w-1/2" /><Skeleton className="mt-2 h-3 w-1/3" /></div>
              <Skeleton className="h-8 w-28" />
            </div>
          ))}
        </div>
        <div className={cx(CARD, 'p-5')}>
          <Skeleton className="h-5 w-48" />
          {Array.from({ length: 4 }, (_, i) => <div key={i} className="mt-5"><Skeleton className="h-4 w-2/3" /><Skeleton className="mt-2 h-2 w-full rounded-full" /></div>)}
        </div>
      </div>
    </>
  ),
  list: () => (<><Head actions /><Chips /><Rows n={8} /></>),
  settings: () => (
    <>
      <Head />
      <div className="grid gap-6 md:grid-cols-[13rem_minmax(0,1fr)]">
        <div className="hidden space-y-1.5 md:block">{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-9 w-full" />)}</div>
        <div className={cx(CARD, 'space-y-5 p-5')}>
          {Array.from({ length: 4 }, (_, i) => <div key={i}><Skeleton className="h-4 w-32" /><Skeleton className="mt-2 h-10 w-full" /></div>)}
        </div>
      </div>
    </>
  ),
  workspace: () => (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div><Skeleton className="h-4 w-40" /><Skeleton className="mt-2.5 h-7 w-72 max-w-full" /></div>
        <div className="flex gap-2"><Skeleton className="h-9 w-28" /><Skeleton className="h-9 w-28" /></div>
      </div>
      <div className="mb-3 flex flex-wrap gap-2">{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-8 w-24" />)}</div>
      <Rows n={14} dense />
    </>
  ),
  record: () => (
    <>
      <Skeleton className="mb-3 h-3.5 w-32" />
      <Head actions />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => <div key={i} className={cx(CARD, 'p-5')}><Skeleton className="h-4 w-24" /><Skeleton className="mt-3 h-7 w-16" /></div>)}
      </div>
      <div className="mt-6"><Rows n={5} /></div>
    </>
  ),
  upload: () => (
    <>
      <Head />
      <div className="mb-6 flex gap-3">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-2 flex-1 rounded-full" />)}</div>
      <div className={cx(CARD, 'grid place-items-center border-dashed p-12')}>
        <Skeleton className="size-12 rounded-full" />
        <Skeleton className="mt-4 h-5 w-64 max-w-full" />
        <Skeleton className="mt-2 h-4 w-48 max-w-full" />
      </div>
    </>
  ),
  page: () => (<><Head /><Rows n={6} /></>),
};

/**
 * Placeholder for a page while its server data loads, shaped like that page (KPI cards for the dashboard, a
 * table for lists, the section menu for settings, the grid for a catalogue). The navigation watchdog and the
 * e2e suite look for its markers (aria-busy, data-page-skeleton: src/ui/shell/same-route-links.ts).
 */
export function RouteSkeleton() {
  const { ta } = useI18n();
  const kind = skeletonKind(usePathname());
  const wide = kind !== 'settings' && kind !== 'upload';
  return (
    <div className={pageContainerClass(wide)} aria-busy="true" data-page-skeleton="" data-skeleton={kind}>
      <span className="sr-only">{ta.shellX.ui.loading}</span>
      {BODY[kind]()}
    </div>
  );
}
