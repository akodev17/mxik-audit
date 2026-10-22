'use client';

import { useState } from 'react';
import { bulkDryRun, type BulkActionInput, type DryRunResult } from '@/app/actions/bulk';
import { fmtNumber } from '@tasnivo/i18n/format';
import { useI18n } from '@/lib/locale-client';
import { filterQuery, type WsFilter } from '@tasnivo/domain/workspace-filter';
import { Button } from '@/ui/button';
import { ConfirmDialog, type ConfirmResult } from '@/ui/confirm-dialog';
import { CodeSearch } from './code-search';
import { needsBulkConfirm } from './bulk-confirm';
import { count } from './ws-text';

type Picked = { code: string; name: string };

type Props = {
  catalogId: string;
  filter: WsFilter;
  count: number;
  /** The selected finding ids (ignored once the whole filter is selected). */
  ids: readonly string[];
  /** Every loaded pending row is selected. */
  everyLoaded: boolean;
  /** Rows of the whole filter, when more than the loaded ones can be selected. */
  filterTotal: number | null;
  allFiltered: boolean;
  busy: boolean;
  onSelectFiltered: () => void;
  onClear: () => void;
  /** Runs the action on the selection or the whole filter; `inDialog`: errors show in the dialog, not as a toast. */
  onRun: (action: BulkActionInput, picked?: Picked, inDialog?: boolean) => Promise<ConfirmResult>;
};

type Pending = { action: BulkActionInput; picked?: Picked; preview: DryRunResult | null };

/**
 * Actions for the selected rows. A small hand-picked selection runs at once
 * (with an undo toast); a larger one, every loaded row, or the whole filter
 * first shows how many pending rows the action will touch (a server dry run)
 * and whether the per-action cap cuts it short.
 */
export function BulkBar(p: Props) {
  const { ta, locale } = useI18n();
  const b = ta.wsX.bulk;
  const [assigning, setAssigning] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);

  const start = (action: BulkActionInput, picked?: Picked): void => {
    if (!needsBulkConfirm({ allFiltered: p.allFiltered, selected: p.count, everyLoaded: p.everyLoaded })) { void p.onRun(action, picked); return; }
    setPending({ action, picked, preview: null });
    const target = p.allFiltered ? { filter: filterQuery(p.filter) } : { ids: [...p.ids] };
    bulkDryRun({ catalogId: p.catalogId, target, action })
      .then((preview) => setPending((cur) => (cur && cur.action === action ? { ...cur, preview } : cur)))
      .catch(() => setPending((cur) => (cur && cur.action === action ? { ...cur, preview: { ok: false, error: ta.wsX.toast.network } } : cur)));
  };

  const kind = pending?.action.kind === 'flag' ? 'flag' : pending?.action.kind ?? 'accept';
  const preview = pending?.preview ?? null;
  const ready = preview?.ok ? preview : null;
  const touch = ready?.willTouch ?? 0;
  const nothing = p.allFiltered ? b.nothing : b.nothingSel;
  const confirmOnly = ready && ready.confirmOnly > 0 ? count(locale, b.dryRunConfirmOnly, ready.confirmOnly) : null;
  const description = !preview ? b.checking
    : !preview.ok ? preview.error
      : touch === 0 ? [nothing, confirmOnly].filter(Boolean).join(' ')
        : [
          count(locale, kind === 'flag' ? b.dryRunFlag : b.dryRun, touch),
          confirmOnly,
          ready?.capped ? b.capped(fmtNumber(locale, ready.limit), fmtNumber(locale, ready.matching), ready.matching) : null,
        ].filter(Boolean).join(' ');

  return (
    <div className="no-print border-b border-line bg-brand-tint px-4 py-2 md:px-5">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-small font-semibold text-fg" aria-live="polite">
          {p.allFiltered ? count(locale, b.allFiltered, p.count) : count(locale, b.selected, p.count)}
        </span>
        {p.filterTotal !== null && !p.allFiltered ? (
          <Button size="compact" variant="ghost" onClick={p.onSelectFiltered}>{count(locale, b.selectFiltered, p.filterTotal)}</Button>
        ) : null}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button size="sm" variant="primary" disabled={p.busy} onClick={() => start({ kind: 'accept' })}>{b.accept}</Button>
          <Button size="sm" disabled={p.busy} aria-expanded={assigning} onClick={() => setAssigning((a) => !a)}>{b.assign}</Button>
          <Button size="sm" variant="danger" disabled={p.busy} onClick={() => start({ kind: 'reject' })}>{b.reject}</Button>
          <Button size="sm" disabled={p.busy} onClick={() => start({ kind: 'flag', flag: 'ask_client' })}>{b.ask}</Button>
          <Button size="sm" variant="ghost" onClick={p.onClear}>{b.clear}</Button>
        </div>
      </div>
      {assigning ? (
        <div className="mt-2 max-w-xl">
          <p className="mb-1 text-micro text-muted">{count(locale, b.assignHint, p.count)}</p>
          <CodeSearch disabled={p.busy} onPick={(code, name) => { setAssigning(false); start({ kind: 'assign', code }, { code, name }); }} />
        </div>
      ) : null}
      <ConfirmDialog
        open={pending !== null}
        onClose={() => setPending(null)}
        title={(p.allFiltered ? b.confirmTitle : b.confirmTitleSel)[kind]}
        description={description}
        scope={p.allFiltered ? b.scopeFilter : count(locale, b.scopeSelection, p.count)}
        tone={kind === 'reject' ? 'danger' : 'default'}
        confirmLabel={count(locale, b.confirmLabel[kind], touch)}
        onConfirm={async () => {
          if (!pending || !ready || touch === 0) return { ok: false, error: !preview ? b.checking : nothing };
          return p.onRun(pending.action, pending.picked, true);
        }}
      />
    </div>
  );
}
