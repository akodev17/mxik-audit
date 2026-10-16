'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { acceptAllAbove, decide, decideGroup, splitRow, undo } from '@/app/actions/review';
import { t } from '@/lib/i18n';
import { GroupHeader } from './review-group';
import { RowView, type ReviewRow } from './review-row';

export type { ReviewRow } from './review-row';

type Entry =
  | { kind: 'row'; row: ReviewRow; inGroup: boolean }
  | { kind: 'group'; key: string; rows: ReviewRow[] };

/**
 * Rows sharing a group key collapse into one group entry at the first
 * member's position; expanded groups list their members right after it.
 */
function entriesOf(rows: readonly ReviewRow[], expanded: ReadonlySet<string>): Entry[] {
  const members = new Map<string, ReviewRow[]>();
  for (const row of rows) {
    if (!row.groupKey) continue;
    members.set(row.groupKey, [...(members.get(row.groupKey) ?? []), row]);
  }
  const out: Entry[] = [];
  const placed = new Set<string>();
  for (const row of rows) {
    const group = row.groupKey ? members.get(row.groupKey) : undefined;
    if (!row.groupKey || !group || group.length < 2) {
      out.push({ kind: 'row', row, inGroup: false });
      continue;
    }
    if (placed.has(row.groupKey)) continue;
    placed.add(row.groupKey);
    out.push({ kind: 'group', key: row.groupKey, rows: group });
    if (expanded.has(row.groupKey)) out.push(...group.map((r) => ({ kind: 'row' as const, row: r, inGroup: true })));
  }
  return out;
}

export function ReviewList({ catalogId, rows: initial }: { catalogId: string; rows: ReviewRow[] }) {
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [cursor, setCursor] = useState(0);
  const [busy, startBusy] = useTransition();
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState<string | null>(null);
  const entryRefs = useRef<(HTMLTableRowElement | null)[]>([]);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // A server refresh (after a decision, undo or bulk accept) brings fresh row
  // contents. Keep the order the reviewer is working in, or the j/k cursor
  // would jump as decided rows re-sort.
  useEffect(() => {
    setRows((current) => {
      const fresh = new Map(initial.map((r) => [r.findingId, r]));
      const kept = current.flatMap((r) => {
        const updated = fresh.get(r.findingId);
        return updated ? [updated] : [];
      });
      const known = new Set(current.map((r) => r.findingId));
      return [...kept, ...initial.filter((r) => !known.has(r.findingId))];
    });
  }, [initial]);

  const entries = useMemo(() => entriesOf(rows, expanded), [rows, expanded]);
  const decided = rows.filter((r) => r.decision !== 'pending').length;

  const apply = useCallback((findingId: string, decision: 'accepted' | 'rejected', chosen?: string) => {
    // A decided row has to be undone first; nothing is overwritten silently.
    if (rows.find((r) => r.findingId === findingId)?.decision !== 'pending') return;
    // Optimistic: an accountant working through hundreds of rows should never
    // wait on a round trip. Reverted if the server disagrees.
    const before = rows;
    setRows((current) => current.map((r) =>
      r.findingId === findingId
        ? { ...r, decision, chosenMxik: decision === 'accepted' ? (chosen ?? r.suggestedMxik) : null }
        : r));
    startBusy(async () => {
      const result = await decide({ findingId, decision, chosenMxik: chosen ?? null });
      if (!result.ok) {
        setRows(before);
        return;
      }
      setRows((current) => current.map((r) => (r.findingId === findingId ? { ...r, decisionEventId: result.eventId } : r)));
      router.refresh();
    });
  }, [rows, router]);

  const applyGroup = useCallback((group: readonly ReviewRow[], decision: 'accepted' | 'rejected') => {
    const ids = group.filter((r) => r.decision === 'pending').map((r) => r.findingId);
    if (ids.length === 0) return;
    const before = rows;
    const targets = new Set(ids);
    setRows((current) => current.map((r) => (targets.has(r.findingId)
      ? { ...r, decision, chosenMxik: decision === 'accepted' ? r.suggestedMxik : null }
      : r)));
    startBusy(async () => {
      const result = await decideGroup({ findingIds: ids, decision });
      if (!result.ok) {
        setRows(before);
        return;
      }
      const events = new Map(result.decided.map((d) => [d.findingId, d.eventId]));
      // Rows the server refused (decided elsewhere meanwhile) go back to their state on refresh.
      setRows((current) => current.map((r) => (events.has(r.findingId) ? { ...r, decisionEventId: events.get(r.findingId) ?? null } : r)));
      router.refresh();
    });
  }, [rows, router]);

  const split = useCallback((findingId: string) => {
    setRows((current) => current.map((r) => (r.findingId === findingId ? { ...r, groupKey: null } : r)));
    startBusy(async () => {
      await splitRow(findingId);
      router.refresh();
    });
  }, [router]);

  const revert = useCallback((payload: { eventId: string; findingId?: string } | { lastInCatalog: string }) => {
    setNotice(null);
    startBusy(async () => {
      const result = await undo(payload);
      if (!result.ok) {
        setNotice(result.error);
        return;
      }
      const reverted = new Set(result.findingIds);
      setRows((current) => current.map((r) => (reverted.has(r.findingId)
        ? { ...r, decision: 'pending', chosenMxik: null, decisionEventId: null }
        : r)));
      router.refresh();
    });
  }, [router]);

  const toggle = useCallback((key: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const move = useCallback((delta: number) => {
    setCursor((c) => Math.max(0, Math.min(entries.length - 1, c + delta)));
  }, [entries.length]);

  // j/k/Enter/r. Accountants process hundreds of rows; mouse-only is rejected.
  //
  // The shortcuts only fire while focus is inside the list. A window-level
  // handler without that guard means any stray keystroke reaching the page
  // silently accepts or rejects a row — which is exactly what happened during
  // testing, and there is no undo.
  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      const target = event.target;
      // Never hijack keys while the reviewer is typing in the code search.
      if (target instanceof HTMLElement
          && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        if (event.key === 'Escape') setPickerFor(null);
        return;
      }
      // Modified keys belong to the browser, not to us.
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const container = containerRef.current;
      if (!container || !container.contains(document.activeElement)) return;

      const entry = entries[cursor];
      switch (event.key) {
        case 'j': case 'ArrowDown': event.preventDefault(); move(1); break;
        case 'k': case 'ArrowUp': event.preventDefault(); move(-1); break;
        case 'Enter':
          if (entry?.kind === 'group') { event.preventDefault(); applyGroup(entry.rows, 'accepted'); move(1); }
          else if (entry?.row.suggestedMxik) { event.preventDefault(); apply(entry.row.findingId, 'accepted'); move(1); }
          break;
        case 'r':
          if (entry?.kind === 'group') { event.preventDefault(); applyGroup(entry.rows, 'rejected'); move(1); }
          else if (entry) { event.preventDefault(); apply(entry.row.findingId, 'rejected'); move(1); }
          break;
        case 'o':
          if (entry?.kind === 'row') { event.preventDefault(); setPickerFor(entry.row.findingId); }
          break;
        case 'u':
          event.preventDefault();
          revert({ lastInCatalog: catalogId });
          break;
        case 'Escape': setPickerFor(null); break;
        default: break;
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cursor, entries, move, apply, applyGroup, revert, catalogId]);

  useEffect(() => {
    entryRefs.current[cursor]?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  // Focus the list on mount so a reviewer can start typing j/k straight away
  // without hunting for something to click.
  useEffect(() => {
    containerRef.current?.focus({ preventScroll: true });
  }, []);

  function bulkAccept(): void {
    startBusy(async () => {
      const result = await acceptAllAbove({ catalogId, minConfidence: 0.9 });
      if (result.ok && result.count > 0) {
        setRows((current) => current.map((r) =>
          r.decision === 'pending' && r.confidence !== null && r.confidence >= 0.9 && r.suggestedMxik
            ? { ...r, decision: 'accepted', chosenMxik: r.suggestedMxik }
            : r));
        router.refresh();
      }
    });
  }

  if (rows.length === 0) {
    return <p className="text-ink-soft">{t.reviewNothingToReview}</p>;
  }

  const activate = (index: number) => () => {
    setCursor(index);
    containerRef.current?.focus({ preventScroll: true });
  };
  const groups = entries.filter((e) => e.kind === 'group').length;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-soft tnum">
          {t.reviewProgress(decided, rows.length)}
          {groups > 0 ? <span className="ml-2 text-ink-faint">· {t.groupCount(groups)}</span> : null}
        </p>
        <div className="flex flex-wrap items-center gap-4">
          <span className="text-xs text-ink-faint">{t.reviewKeyboardHint}</span>
          <button
            type="button" onClick={() => revert({ lastInCatalog: catalogId })} disabled={busy || decided === 0}
            className="border border-rule px-3 py-1.5 text-sm hover:bg-paper-tint disabled:opacity-50"
          >
            {t.reviewUndoLast}
          </button>
          <button
            type="button" onClick={bulkAccept} disabled={busy}
            className="border border-ink px-3 py-1.5 text-sm hover:bg-paper-tint disabled:opacity-50"
          >
            {t.reviewAcceptAllAbove}
          </button>
        </div>
      </div>
      {notice ? (
        <p role="alert" className="mb-3 border-l-2 border-risk bg-risk-tint px-3 py-2 text-sm text-ink-soft">{notice}</p>
      ) : null}

      <div
        ref={containerRef}
        tabIndex={0}
        role="group"
        aria-label={t.reviewTitle}
        className="overflow-x-auto border border-rule focus:outline-none focus-visible:ring-2 focus-visible:ring-ink"
      >
        <table className="min-w-full text-sm">
          <thead className="bg-paper-tint">
            <tr className="text-left">
              <th className="border-b border-rule px-3 py-2 font-medium">#</th>
              <th className="border-b border-rule px-3 py-2 font-medium">{t.reviewProduct}</th>
              <th className="border-b border-rule px-3 py-2 font-medium">{t.reviewCurrentCode}</th>
              <th className="border-b border-rule px-3 py-2 font-medium">{t.reviewSuggested}</th>
              <th className="border-b border-rule px-3 py-2 font-medium">{t.reviewConfidence}</th>
              <th className="border-b border-rule px-3 py-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {entries.map((entry, index) => (entry.kind === 'group' ? (
              <GroupHeader
                key={`g:${entry.key}`}
                rows={entry.rows}
                active={index === cursor}
                busy={busy}
                expanded={expanded.has(entry.key)}
                onActivate={activate(index)}
                onToggle={() => toggle(entry.key)}
                onDecide={(decision) => applyGroup(entry.rows, decision)}
                rowRef={(el) => { entryRefs.current[index] = el; }}
              />
            ) : (
              <RowView
                key={entry.row.findingId}
                row={entry.row}
                active={index === cursor}
                busy={busy}
                inGroup={entry.inGroup}
                pickerOpen={pickerFor === entry.row.findingId}
                onActivate={activate(index)}
                onDecide={(decision, chosen) => apply(entry.row.findingId, decision, chosen)}
                onUndo={() => revert({ eventId: entry.row.decisionEventId ?? '', findingId: entry.row.findingId })}
                onPicker={(open) => setPickerFor(open ? entry.row.findingId : null)}
                onSplit={() => split(entry.row.findingId)}
                rowRef={(el) => { entryRefs.current[index] = el; }}
              />
            )))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
