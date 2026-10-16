'use client';

import { useEffect, useState, useTransition } from 'react';
import { lookupCodes, type ClassifierHit } from '@/app/actions/review';
import { ConfidenceBadge, TypeBadge } from '@/components/badges';
import { CodeCell } from '@/components/code-cell';
import { BarcodeBadge, MarkingBadge, WhyThisCode } from '@/components/evidence';
import type { FindingRow } from '@/lib/finding-view';
import { t } from '@/lib/i18n';

export type ReviewRow = FindingRow;

const DECISION_LABEL = {
  pending: t.reviewPending,
  accepted: t.reviewAccepted,
  rejected: t.reviewRejected,
} as const;

export type RowViewProps = {
  row: ReviewRow;
  active: boolean;
  busy: boolean;
  pickerOpen: boolean;
  /** Rendered inside an expanded group: indented, with "split out". */
  inGroup?: boolean;
  onActivate: () => void;
  onDecide: (decision: 'accepted' | 'rejected', chosen?: string) => void;
  onUndo: () => void;
  onPicker: (open: boolean) => void;
  onSplit?: () => void;
  rowRef?: (el: HTMLTableRowElement | null) => void;
};

/** One finding as a table row: product, current code, suggestion and actions. */
export function RowView(props: RowViewProps) {
  const { row, active, busy, pickerOpen, inGroup, onActivate, onDecide, onUndo, onPicker, onSplit, rowRef } = props;
  const suggestionLive = row.suggestedInfo?.live !== false;
  return (
    <tr
      ref={rowRef}
      data-active={active}
      onClick={onActivate}
      className={`border-b border-rule align-top last:border-0 ${inGroup ? 'bg-paper-tint/40' : ''}`}
    >
      <td className={`py-2 text-ink-faint tnum ${inGroup ? 'pl-6 pr-3' : 'px-3'}`}>{row.rowIndex + 1}</td>

      <td className="max-w-sm px-3 py-2">
        <span className="block font-medium">{row.productName}</span>
        <span className="mt-0.5 flex flex-wrap items-center gap-2">
          <TypeBadge type={row.type} severity={row.severity} />
          {row.unit ? <span className="text-xs text-ink-faint">{row.unit}</span> : null}
          <MarkingBadge
            current={row.currentInfo?.isMarked === true}
            suggested={row.suggestedMxik !== row.currentMxik && row.suggestedInfo?.isMarked === true}
          />
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
              <span className="block text-xs text-ink-faint">{t.reviewBoundUnit}: {row.suggestedInfo.unit}</span>
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
                        onClick={() => onDecide('accepted', alt.code)}
                        disabled={row.decision !== 'pending' || (alt.info !== null && !alt.info.live)}
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
        {pickerOpen ? (
          <CodePicker
            onPick={(code) => { onDecide('accepted', code); onPicker(false); }}
            onClose={() => onPicker(false)}
          />
        ) : null}
      </td>

      <td className="px-3 py-2"><ConfidenceBadge confidence={row.confidence} barcode={row.evidence?.barcode} /></td>

      <td className="px-3 py-2">
        {row.decision === 'pending' ? (
          <div className="flex flex-col gap-1">
            <button
              type="button" disabled={!row.suggestedMxik || !suggestionLive}
              onClick={() => onDecide('accepted')}
              className="whitespace-nowrap bg-ink px-2 py-1 text-xs text-paper disabled:opacity-40"
            >
              {t.reviewAccept}
            </button>
            <button
              type="button"
              onClick={() => onDecide('rejected')}
              className="whitespace-nowrap border border-rule px-2 py-1 text-xs hover:bg-paper-tint"
            >
              {t.reviewReject}
            </button>
            <button type="button" onClick={() => onPicker(true)} className="whitespace-nowrap text-xs text-ink-soft underline">
              {t.reviewPickOther}
            </button>
            {inGroup && onSplit ? (
              <button type="button" disabled={busy} onClick={onSplit} className="whitespace-nowrap text-xs text-ink-soft underline disabled:opacity-50">
                {t.groupSplit}
              </button>
            ) : null}
          </div>
        ) : (
          <div className="flex flex-col items-start gap-1">
            <span className={`whitespace-nowrap text-xs ${row.decision === 'accepted' ? 'text-ok' : 'text-ink-faint'}`}>
              {DECISION_LABEL[row.decision]}
            </span>
            {row.decisionEventId ? (
              <button
                type="button" disabled={busy} onClick={onUndo}
                className="whitespace-nowrap text-xs text-ink-soft underline hover:text-ink disabled:opacity-50"
              >
                {t.reviewUndo}
              </button>
            ) : null}
          </div>
        )}
      </td>
    </tr>
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
            <button type="button" onClick={() => onPick(hit.code)} className="w-full px-1 py-1 text-left hover:bg-paper-tint">
              <span className="code block text-xs">{hit.code}</span>
              <span className="block text-xs text-ink-soft">{hit.name}</span>
              {hit.path ? <span className="block text-xs text-ink-faint">{hit.path}</span> : null}
            </button>
          </li>
        ))}
      </ul>
      <button type="button" onClick={onClose} className="mt-1 text-xs text-ink-soft underline">{t.back}</button>
    </div>
  );
}
