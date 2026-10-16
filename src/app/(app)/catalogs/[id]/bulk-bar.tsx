'use client';

import { useState } from 'react';
import { ta } from '@/lib/i18n-app';
import { Button } from '@/ui/button';
import { CodeSearch } from './code-search';

type Props = {
  count: number;
  /** Rows of the whole filter, when more than the loaded ones can be selected. */
  filterTotal: number | null;
  allFiltered: boolean;
  busy: boolean;
  onSelectFiltered: () => void;
  onClear: () => void;
  onAccept: () => void;
  onReject: () => void;
  onAssign: (code: string, name: string) => void;
  onAsk: () => void;
};

/** Actions for the selected rows; appears only while something is selected. */
export function BulkBar({ count, filterTotal, allFiltered, busy, onSelectFiltered, onClear, onAccept, onReject, onAssign, onAsk }: Props) {
  const [assigning, setAssigning] = useState(false);
  return (
    <div className="no-print border-b border-brand/30 bg-brand-tint px-5 py-2">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-bold">{ta.bulk.selected(count)}</span>
        {filterTotal !== null && !allFiltered ? (
          <button type="button" onClick={onSelectFiltered} className="text-sm text-brand hover:underline">{ta.bulk.selectFiltered(filterTotal)}</button>
        ) : null}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button size="sm" variant="primary" disabled={busy} onClick={onAccept}>{ta.bulk.accept}</Button>
          <Button size="sm" disabled={busy} onClick={() => setAssigning((a) => !a)}>{ta.bulk.assign}</Button>
          <Button size="sm" disabled={busy} onClick={onReject}>{ta.bulk.reject}</Button>
          <Button size="sm" disabled={busy} onClick={onAsk}>{ta.bulk.ask}</Button>
          <Button size="sm" variant="ghost" onClick={onClear}>{ta.bulk.clear}</Button>
        </div>
      </div>
      {assigning ? (
        <div className="mt-2 max-w-xl">
          <p className="mb-1 text-xs text-muted">{ta.bulk.assignHint(count)}</p>
          <CodeSearch disabled={busy} onPick={(code, name) => { setAssigning(false); onAssign(code, name); }} />
        </div>
      ) : null}
    </div>
  );
}
