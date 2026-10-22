'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { loadRowDetail } from '@/app/actions/workspace';
import { useI18n } from '@/lib/locale-client';
import type { RowDetail } from '@/lib/row-detail';
import type { GridRow } from '@/lib/workspace-rows';
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
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const rowRef = useRef(row);
  rowRef.current = row;
  const id = row?.findingId ?? null;
  // A decision (or its undo) changes who/when, so the detail reloads.
  const version = row?.decisionEventId ?? 'none';

  useEffect(() => {
    if (!id) { setShown(null); return; }
    let live = true;
    setFailed(false);
    loadRowDetail(id)
      .then((d) => {
        if (!live) return;
        const current = rowRef.current;
        if (d && current) setShown({ row: current, detail: d }); else setFailed(true);
      })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [id, version, attempt]);

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
          action={<Button size="sm" onClick={() => setAttempt((a) => a + 1)}>{x.drawer.retry}</Button>}
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
