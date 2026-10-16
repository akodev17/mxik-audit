'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { acceptAllAbove, decide, lookupCodes, undo, type ClassifierHit } from '@/app/actions/review';
import { ConfidenceBadge, TypeBadge } from '@/components/chrome';
import { CodeCell } from '@/components/code-cell';
import { BarcodeBadge, WhyThisCode } from '@/components/evidence';
import type { FindingRow } from '@/lib/finding-view';
import { t } from '@/lib/i18n';

export type ReviewRow = FindingRow;

const DECISION_LABEL = {
  pending: t.reviewPending,
  accepted: t.reviewAccepted,
  rejected: t.reviewRejected,
} as const;

export function ReviewList({ catalogId, rows: initial }: { catalogId: string; rows: ReviewRow[] }) {
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [cursor, setCursor] = useState(0);
  const [busy, startBusy] = useTransition();
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const rowRefs = useRef<(HTMLTableRowElement | null)[]>([]);
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

  const move = useCallback((delta: number) => {
    setCursor((c) => Math.max(0, Math.min(rows.length - 1, c + delta)));
  }, [rows.length]);

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

      const row = rows[cursor];
      switch (event.key) {
        case 'j': case 'ArrowDown': event.preventDefault(); move(1); break;
        case 'k': case 'ArrowUp': event.preventDefault(); move(-1); break;
        case 'Enter':
          if (row?.suggestedMxik) { event.preventDefault(); apply(row.findingId, 'accepted'); move(1); }
          break;
        case 'r':
          if (row) { event.preventDefault(); apply(row.findingId, 'rejected'); move(1); }
          break;
        case 'o':
          if (row) { event.preventDefault(); setPickerFor(row.findingId); }
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
  }, [cursor, rows, move, apply, revert, catalogId]);

  useEffect(() => {
    rowRefs.current[cursor]?.scrollIntoView({ block: 'nearest' });
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

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-soft tnum">{t.reviewProgress(decided, rows.length)}</p>
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
            {rows.map((row, index) => (
              <tr
                key={row.findingId}
                ref={(el) => { rowRefs.current[index] = el; }}
                data-active={index === cursor}
                onClick={() => { setCursor(index); containerRef.current?.focus({ preventScroll: true }); }}
                className="border-b border-rule align-top last:border-0"
              >
                <td className="px-3 py-2 text-ink-faint tnum">{row.rowIndex + 1}</td>

                <td className="max-w-sm px-3 py-2">
                  <span className="block font-medium">{row.productName}</span>
                  <span className="mt-0.5 flex items-center gap-2">
                    <TypeBadge type={row.type} severity={row.severity} />
                    {row.unit ? <span className="text-xs text-ink-faint">{row.unit}</span> : null}
                  </span>
                  <span className="mt-1 block text-xs text-ink-faint">{row.reason}</span>
                </td>

                <td className="max-w-xs px-3 py-2">
                  <CodeCell code={row.currentMxik} info={row.currentInfo} empty={t.reviewNoCode} />
                </td>

                <td className="max-w-md px-3 py-2">
                  {row.suggestedMxik ? (
                    <>
                      {row.chosenMxik && row.chosenMxik !== row.suggestedMxik
                        ? <CodeCell code={row.chosenMxik} info={row.chosenInfo} />
                        : <CodeCell code={row.suggestedMxik} info={row.suggestedInfo} />}
                      {row.suggestedInfo?.unit ? (
                        <span className="block text-xs text-ink-faint">
                          {t.reviewBoundUnit}: {row.suggestedInfo.unit}
                        </span>
                      ) : null}
                      {row.evidence?.barcode ? <span className="mt-1 block"><BarcodeBadge /></span> : null}
                      <WhyThisCode
                        evidence={row.evidence} confidence={row.confidence}
                        rowUnit={row.unit} codeUnit={row.suggestedInfo?.unit ?? null}
                      />
                      {row.alternatives.length > 1 ? (
                        <details className="mt-1">
                          <summary className="cursor-pointer text-xs text-ink-soft">
                            {t.reviewAlternatives} ({row.alternatives.length - 1})
                          </summary>
                          <ul className="mt-1 space-y-1.5">
                            {row.alternatives.slice(1).map((alt) => (
                              <li key={alt.code} className="flex items-start gap-2">
                                <button
                                  type="button"
                                  onClick={() => apply(row.findingId, 'accepted', alt.code)}
                                  disabled={alt.info !== null && !alt.info.live}
                                  className="code shrink-0 text-xs underline hover:text-ink disabled:no-underline disabled:opacity-50"
                                >
                                  {alt.code}
                                </button>
                                <span className="text-xs text-ink-faint">
                                  {alt.info?.name ?? alt.name}
                                  {alt.info?.shortPath ? <span className="block" title={alt.info.fullPath}>{alt.info.shortPath}</span> : null}
                                </span>
                                <ConfidenceBadge confidence={alt.confidence} barcode={alt.evidence?.barcode} />
                              </li>
                            ))}
                          </ul>
                        </details>
                      ) : null}
                    </>
                  ) : (
                    <span className="text-xs text-ink-faint">—</span>
                  )}
                  {pickerFor === row.findingId ? (
                    <CodePicker
                      onPick={(code) => { apply(row.findingId, 'accepted', code); setPickerFor(null); }}
                      onClose={() => setPickerFor(null)}
                    />
                  ) : null}
                </td>

                <td className="px-3 py-2"><ConfidenceBadge confidence={row.confidence} barcode={row.evidence?.barcode} /></td>

                <td className="px-3 py-2">
                  {row.decision === 'pending' ? (
                    <div className="flex flex-col gap-1">
                      <button
                        type="button" disabled={!row.suggestedMxik || row.suggestedInfo?.live === false}
                        onClick={() => apply(row.findingId, 'accepted')}
                        className="whitespace-nowrap bg-ink px-2 py-1 text-xs text-paper disabled:opacity-40"
                      >
                        {t.reviewAccept}
                      </button>
                      <button
                        type="button"
                        onClick={() => apply(row.findingId, 'rejected')}
                        className="whitespace-nowrap border border-rule px-2 py-1 text-xs hover:bg-paper-tint"
                      >
                        {t.reviewReject}
                      </button>
                      <button
                        type="button"
                        onClick={() => setPickerFor(row.findingId)}
                        className="whitespace-nowrap text-xs text-ink-soft underline"
                      >
                        {t.reviewPickOther}
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-col items-start gap-1">
                      <span className={`whitespace-nowrap text-xs ${row.decision === 'accepted' ? 'text-ok' : 'text-ink-faint'}`}>
                        {DECISION_LABEL[row.decision]}
                      </span>
                      {row.decisionEventId ? (
                        <button
                          type="button" disabled={busy}
                          onClick={() => revert({ eventId: row.decisionEventId ?? '', findingId: row.findingId })}
                          className="whitespace-nowrap text-xs text-ink-soft underline hover:text-ink disabled:opacity-50"
                        >
                          {t.reviewUndo}
                        </button>
                      ) : null}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Free-text classifier search, for when none of the suggestions is right. */
function CodePicker({ onPick, onClose }: { onPick: (code: string) => void; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<ClassifierHit[]>([]);
  const [searching, startSearch] = useTransition();

  useEffect(() => {
    if (query.trim().length < 2) { setHits([]); return; }
    const timer = setTimeout(() => {
      startSearch(async () => setHits(await lookupCodes(query)));
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  return (
    <div className="mt-2 border border-ink bg-paper p-2">
      <input
        autoFocus value={query} onChange={(e) => setQuery(e.target.value)}
        placeholder={t.reviewPickOther}
        className="w-full border border-rule px-2 py-1 text-sm focus:border-ink focus:outline-none"
      />
      {searching ? <p className="mt-1 text-xs text-ink-faint">{t.loading}</p> : null}
      <ul className="mt-1 max-h-56 overflow-y-auto">
        {hits.map((hit) => (
          <li key={hit.code}>
            <button
              type="button" onClick={() => onPick(hit.code)}
              className="w-full px-1 py-1 text-left hover:bg-paper-tint"
            >
              <span className="code block text-xs">{hit.code}</span>
              <span className="block text-xs text-ink-soft">{hit.name}</span>
              {hit.path ? <span className="block text-xs text-ink-faint">{hit.path}</span> : null}
            </button>
          </li>
        ))}
      </ul>
      <button type="button" onClick={onClose} className="mt-1 text-xs text-ink-soft underline">
        {t.back}
      </button>
    </div>
  );
}
