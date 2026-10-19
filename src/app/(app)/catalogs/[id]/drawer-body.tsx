'use client';

import { useState, type RefObject } from 'react';
import { fmtNumber } from '@/lib/format';
import { useI18n } from '@/lib/locale-client';
import type { RowDetail } from '@/lib/row-detail';
import type { GridRow } from '@/lib/workspace-rows';
import { Badge, StatusChip, StatusIcon } from '@/ui/badge';
import { Button } from '@/ui/button';
import { CodeChip } from '@/ui/code-chip';
import { IconInfo } from '@/ui/icons';
import { typeLabels, typeTone } from '@/ui/labels';
import { Tooltip } from '@/ui/tooltip';
import { CodeCompare } from './code-compare';
import { CodeSearch } from './code-search';
import { DecisionInfo } from './decision-info';
import { MatchChip } from './match-chip';
import { NameFromBarcodeOffer } from './name-from-barcode';
import { RequestText } from './request-text';
import { RowComments } from './row-comments';
import { SignalList } from './signal-list';
import { UnitAdviceBox } from './unit-advice';
import { WrongFeedback } from './wrong-feedback';

type Props = {
  row: GridRow;
  detail: RowDetail;
  readOnly: boolean;
  /** The grid is grouped and this row is in a group, so it can be taken out. */
  canSplit: boolean;
  searchRef: RefObject<HTMLInputElement | null>;
  onChoose: (code: string, name: string) => void;
  onComments: (count: number, flag: string | null) => void;
  onSplit: () => void;
};

function Meta({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="min-w-0">
      <dt className="text-micro text-muted">{label}</dt>
      <dd className="truncate text-small font-medium text-fg">{value || '—'}</dd>
    </div>
  );
}

/** Everything about one finding: what the check found and why, the codes, the evidence, and the tools to resolve it. */
export function DrawerBody({ row, detail, readOnly, canSplit, searchRef, onChoose, onComments, onSplit }: Props) {
  const { t, ta, locale } = useI18n();
  const x = ta.wsX;
  const [name, setName] = useState(detail.productName);
  const pending = row.decision === 'pending' && !readOnly;
  const suggesting = detail.type === 'MISSING' || detail.type === 'NOT_FOUND' || detail.type === 'MISMATCH';
  const tone = typeTone(detail.type, detail.severity);
  const score = suggesting && !detail.noSuggestion && detail.confidence !== null && detail.stage !== 'barcode' && detail.stage !== 'dictionary'
    ? fmtNumber(locale, detail.confidence, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : null;
  const showRequest = detail.noSuggestion || row.decision === 'rejected';

  return (
    <div className="space-y-5">
      <div>
        <h3 className="break-words text-section text-fg">{name || '—'}</h3>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <StatusChip tone={tone} icon={<StatusIcon tone={tone} size={12} />}>{typeLabels(t)[detail.type] ?? detail.type}</StatusChip>
          {suggesting && !detail.noSuggestion && (detail.confidence !== null || detail.stage === 'barcode' || detail.stage === 'dictionary') ? <MatchChip confidence={detail.confidence} stage={detail.stage} show /> : null}
          {detail.markingCurrent || detail.markingSuggested ? <Badge tone="warn">{ta.drawer.markirovka}</Badge> : null}
          {detail.privileges.length > 0 ? <Badge tone="info" title={detail.privileges.join('; ')}>{ta.drawer.privilege}</Badge> : null}
        </div>
        {score ? (
          <p className="mt-2 flex items-center gap-1.5 text-small text-muted">
            {x.match.score(score)}
            <Tooltip content={ta.matchX.scoreHint} describe={false}>
              <button type="button" aria-label={ta.matchX.scoreHint} className="grid size-6 place-items-center rounded-sm text-muted hover:bg-surface hover:text-fg">
                <IconInfo size={14} />
              </button>
            </Tooltip>
          </p>
        ) : null}
        <dl className="mt-3 grid grid-cols-2 gap-3">
          <Meta label={ta.drawer.unit} value={detail.unit} />
          <Meta label={ta.drawer.barcode} value={detail.barcode} />
        </dl>
      </div>

      <section className="rounded-ctl border border-line bg-surface p-3">
        <h3 className="text-small font-semibold text-fg">{x.reasonTitle}</h3>
        <p className="mt-1 text-small text-fg">{x.explain[detail.type]}</p>
        <p className="mt-1 text-small text-muted"><span className="sr-only">{x.reasonAudit}: </span>{detail.reason}</p>
      </section>

      <DecisionInfo row={row} detail={detail} />

      <CodeCompare title={ta.drawer.current} view={detail.current} other={suggesting ? detail.suggested : null} empty={x.noCode} />
      {suggesting && detail.noSuggestion ? <p className="rounded-ctl bg-surface p-3 text-small text-muted">{x.noSuggestionWhy}</p> : null}
      {suggesting && !detail.noSuggestion ? <CodeCompare title={ta.drawer.suggested} view={detail.suggested} other={detail.current} empty="—" /> : null}
      {detail.chosen ? <CodeCompare title={x.act.chosen} view={detail.chosen} other={detail.current} empty="—" /> : null}
      {!suggesting && x.confirmMeans[detail.type] && detail.mode === 'confirm' ? <p className="rounded-ctl bg-info-tint p-3 text-small text-info-ink">{x.confirmMeans[detail.type]}</p> : null}

      <SignalList signals={detail.signals} />

      {suggesting ? (
        <section>
          <h3 className="mb-2 text-small font-semibold text-fg">{x.drawer.alternatives}</h3>
          {detail.alternatives.length === 0 ? <p className="text-small text-muted">{x.drawer.noAlternatives}</p> : (
            <ul className="divide-y divide-line rounded-ctl border border-line">
              {detail.alternatives.map((a) => (
                <li key={a.code} className="flex items-center gap-3 px-3 py-2">
                  <span className="min-w-0 flex-1">
                    <CodeChip code={a.code} />
                    <span className="mt-0.5 block truncate text-small text-fg" title={a.name}>{a.name}</span>
                    {a.path ? <span className="block truncate text-micro text-muted" title={a.path}>{a.path}</span> : null}
                  </span>
                  <Button size="sm" disabled={!pending} onClick={() => onChoose(a.code, a.name)} aria-label={`${x.drawer.choose}: ${a.code}`}>{ta.drawer.choose}</Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {detail.nameOffer ? <NameFromBarcodeOffer findingId={detail.findingId} offer={detail.nameOffer} readOnly={readOnly} onFilled={setName} /> : null}
      <UnitAdviceBox advice={detail.advice} />

      {pending ? (
        <section>
          <h3 className="mb-2 text-small font-semibold text-fg">{x.drawer.searchTitle}</h3>
          <CodeSearch ref={searchRef} disabled={!pending} onPick={onChoose} />
        </section>
      ) : null}

      <RowComments findingId={detail.findingId} flag={row.flag} readOnly={readOnly} onChange={onComments} />
      {showRequest ? <RequestText findingId={detail.findingId} readOnly={readOnly} /> : null}
      {!readOnly && suggesting && !detail.noSuggestion && detail.suggested ? <WrongFeedback findingId={detail.findingId} /> : null}
      {canSplit && !readOnly ? (
        <section className="border-t border-line pt-4">
          <Button size="sm" variant="ghost" onClick={onSplit}>{x.group.split}</Button>
          <p className="mt-1 text-micro text-muted">{x.group.splitHint}</p>
        </section>
      ) : null}
    </div>
  );
}
