'use client';

import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api/browser';
import { useI18n } from '@/lib/locale-client';
import type { GridRow, RowDetail } from './ws-types';
import { Button } from '@/ui/button';
import { cx } from '@/ui/cx';
import { Drawer } from '@/ui/drawer';
import { EmptyState } from '@/ui/empty-state';
import { Kbd } from '@/ui/kbd';
import { Skeleton } from '@/ui/skeleton';
import { Spinner } from '@/ui/spinner';
import { DecisionCell } from './decision-cell';
import { DrawerBody } from './drawer-body';

type Props = {
  row: GridRow | null;
  readOnly: boolean;
  canSplit: boolean;
  /** Phone: the drawer becomes a full-screen sheet. */
  phone: boolean;
  touch: boolean;
  onClose: () => void;
  onAccept: () => void;
  onReject: () => void;
  onUndo: () => void;
  onChoose: (code: string, name: string) => void;
  onComments: (count: number, flag: string | null) => void;
  onSplit: () => void;
};

type Shown = { row: GridRow; detail: RowDetail };

/**
 * Detail panel for the active row; the grid stays usable behind it. While the
 * next row loads (j/k), the previous row's content stays, dimmed, instead of
 * a skeleton flashing on every keystroke.
 */
export function RowDrawer({ row, readOnly, canSplit, phone, touch, onClose, onAccept, onReject, onUndo, onChoose, onComments, onSplit }: Props) {
  const { ta } = useI18n();
  const x = ta.wsX;
  const [shown, setShown] = useState<Shown | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const rowRef = useRef(row);
  rowRef.current = row;
  const id = row?.findingId ?? null;
  // A decision (or its undo) changes who/when, so the detail reloads.
  const version = row?.decisionEventId ?? 'none';

  // Moving on (j/k) leaves the previous request unobserved, and React Query cancels it.
  const loaded = useQuery({
    queryKey: ['finding', id, 'detail', version],
    queryFn: ({ signal }) => api.workspace.rowDetail({ findingId: id ?? '' }, { signal }),
    enabled: id !== null,
    staleTime: 0,
    retry: false,
  });
  const failed = id !== null && !loaded.isFetching && (loaded.isError || loaded.data === null);

  useEffect(() => {
    if (!id) { setShown(null); return; }
    const current = rowRef.current;
    if (loaded.data && current) setShown({ row: current, detail: loaded.data });
  }, [id, loaded.data]);

  const pick = useCallback(() => { searchRef.current?.focus(); }, []);
  const current = shown && row && shown.detail.findingId === row.findingId;
  const loading = row !== null && !current && !failed;

  const footer = row ? (
    readOnly ? <p className="text-small text-muted">{x.act.readOnly}</p> : (
      <div className="flex flex-wrap items-center gap-2">
        <DecisionCell row={row} readOnly={false} size="sm" prominent onAccept={onAccept} onReject={onReject} onPick={pick} onUndo={onUndo} />
        {row.decision === 'pending' && !touch ? (
          <span className="ml-auto hidden items-center gap-1 text-micro text-muted lg:flex">
            {row.mode === 'pick' ? null : <><Kbd>Enter</Kbd><span aria-hidden>·</span></>}<Kbd>R</Kbd>
          </span>
        ) : null}
      </div>
    )
  ) : null;

  return (
    <Drawer
      open={row !== null}
      title={row ? x.drawer.title(String(row.rowIndex + 1)) : ''}
      onClose={onClose}
      width={phone ? '100vw' : undefined}
      footer={footer}
    >
      {loading ? (
        <span className="absolute right-5 top-2 z-sticky"><Spinner label={x.drawer.loading} size={14} /></span>
      ) : null}
      {failed ? (
        <EmptyState
          tone="danger" size="compact" title={x.drawer.failed}
          action={<Button size="sm" onClick={() => { void loaded.refetch(); }}>{x.drawer.retry}</Button>}
        />
      ) : null}
      {!failed && shown && row ? (
        <div aria-busy={loading || undefined} inert={loading || undefined} className={cx('transition-opacity duration-(--duration-fast)', loading && 'opacity-60')}>
          <DrawerBody
            key={shown.detail.findingId}
            row={current ? row : shown.row} detail={shown.detail} readOnly={readOnly} canSplit={canSplit && Boolean(current)}
            searchRef={searchRef} onChoose={onChoose} onComments={onComments} onSplit={onSplit}
          />
        </div>
      ) : null}
      {!failed && !shown && row ? (
        <div className="space-y-3" aria-busy="true"><Skeleton className="h-6 w-3/4" /><Skeleton className="h-40 w-full" /><Skeleton className="h-40 w-full" /></div>
      ) : null}
    </Drawer>
  );
}
