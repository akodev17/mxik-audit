'use client';

import { ConfidenceBadge } from '@/components/chrome';
import { CodeCell } from '@/components/code-cell';
import { WhyThisCode } from '@/components/evidence';
import { t } from '@/lib/i18n';
import type { ReviewRow } from './review-row';

type Props = {
  rows: ReviewRow[];
  active: boolean;
  busy: boolean;
  expanded: boolean;
  onActivate: () => void;
  onToggle: () => void;
  onDecide: (decision: 'accepted' | 'rejected') => void;
  rowRef?: (el: HTMLTableRowElement | null) => void;
};

/** Similar rows with the same suggestion, decided together. */
export function GroupHeader({ rows, active, busy, expanded, onActivate, onToggle, onDecide, rowRef }: Props) {
  const lead = rows[0];
  if (!lead) return null;
  const pending = rows.filter((r) => r.decision === 'pending').length;
  const accepted = rows.filter((r) => r.decision === 'accepted').length;
  // The group is only as sure as its least sure row.
  const confidence = rows.reduce<number | null>((min, r) => (r.confidence === null ? min : min === null ? r.confidence : Math.min(min, r.confidence)), null);
  const names = rows.slice(0, 3).map((r) => r.productName);

  return (
    <tr ref={rowRef} data-active={active} onClick={onActivate} className="border-b border-rule align-top">
      <td className="px-3 py-2">
        <span className="inline-block border border-ink/30 px-1.5 py-0.5 text-xs tnum">×{rows.length}</span>
      </td>
      <td className="max-w-sm px-3 py-2">
        <span className="block font-medium">{t.groupTitle(rows.length)}</span>
        <span className="mt-0.5 block text-xs text-ink-soft">
          {names.join(' · ')}{rows.length > names.length ? ' …' : ''}
        </span>
        <button type="button" onClick={(e) => { e.stopPropagation(); onToggle(); }} className="mt-1 text-xs text-ink-soft underline">
          {expanded ? t.groupHide : t.groupShow}
        </button>
      </td>
      <td className="px-3 py-2 text-xs text-ink-faint">{t.groupCurrentMixed}</td>
      <td className="max-w-md px-3 py-2">
        <CodeCell code={lead.suggestedMxik} info={lead.suggestedInfo} />
        <WhyThisCode evidence={lead.evidence} confidence={lead.confidence} rowUnit={lead.unit} codeUnit={lead.suggestedInfo?.unit ?? null} />
      </td>
      <td className="px-3 py-2"><ConfidenceBadge confidence={confidence} barcode={rows.every((r) => r.evidence?.barcode)} /></td>
      <td className="px-3 py-2">
        {pending > 0 ? (
          <div className="flex flex-col gap-1">
            <button
              type="button" disabled={busy || lead.suggestedInfo?.live === false}
              onClick={(e) => { e.stopPropagation(); onDecide('accepted'); }}
              className="whitespace-nowrap bg-ink px-2 py-1 text-xs text-paper disabled:opacity-40"
            >
              {t.groupAccept(pending)}
            </button>
            <button
              type="button" disabled={busy}
              onClick={(e) => { e.stopPropagation(); onDecide('rejected'); }}
              className="whitespace-nowrap border border-rule px-2 py-1 text-xs hover:bg-paper-tint disabled:opacity-40"
            >
              {t.groupReject(pending)}
            </button>
          </div>
        ) : (
          <span className="whitespace-nowrap text-xs text-ink-faint">{t.groupDecided(accepted, rows.length - accepted)}</span>
        )}
      </td>
    </tr>
  );
}
