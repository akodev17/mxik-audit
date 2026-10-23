'use client';

import { useMemo, useRef, useState, type RefObject } from 'react';
import { fmtNumber } from '@tasnivo/i18n/format';
import { useI18n } from '@/lib/locale-client';
import type { RowDetail } from './ws-types';
import type { GridRow } from './ws-types';
import { Badge, StatusChip, StatusIcon } from '@/ui/badge';
import { Button } from '@/ui/button';
import { CodeChip } from '@/ui/code-chip';
import { IconInfo } from '@/ui/icons';
import { typeLabels, typeTone } from '@/ui/labels';
import { Tooltip } from '@/ui/tooltip';
import { CodeCompare, CodePair } from './code-compare';
import { CodeSearch } from './code-search';
import { ConfidenceMeter } from './confidence-meter';
import { DecisionInfo } from './decision-info';
import { DrawerSection, SectionNav, type SectionKey } from './drawer-sections';
import { NameFromBarcodeOffer } from './name-from-barcode';
import { reasonLines } from './reason-text';
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

const PRIVILEGE_TYPES = new Set(['PRIVILEGE_CODE', 'PRIVILEGE_OPPORTUNITY']);

/**
 * Everything about one finding: a header with the product and the two codes side by side, then
 * sections (details, codes and evidence, comments, history) reached from a sticky section bar, and
 * the tools to resolve it. The decision itself sits in the drawer's sticky footer.
 */
export function DrawerBody({ row, detail, readOnly, canSplit, searchRef, onChoose, onComments, onSplit }: Props) {
  const { t, ta, locale } = useI18n();
  const x = ta.wsX;
  const u = ta.wsUi.drawer;
  const rootRef = useRef<HTMLDivElement>(null);
  const [name, setName] = useState(detail.productName);
  const pending = row.decision === 'pending' && !readOnly;
  const suggesting = detail.type === 'MISSING' || detail.type === 'NOT_FOUND' || detail.type === 'MISMATCH';
  const tone = typeTone(detail.type, detail.severity);
  const score = suggesting && !detail.noSuggestion && detail.confidence !== null && detail.stage !== 'barcode' && detail.stage !== 'dictionary'
    ? fmtNumber(locale, detail.confidence, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : null;
  const showRequest = detail.noSuggestion || row.decision === 'rejected';
  const lines = reasonLines(detail, x, (v) => detail.labels.units[v] ?? v);
  // A viewer is told once, in the footer; a decided row says how to pick another code.
  const whyNoPick = !readOnly && row.decision !== 'pending' ? x.drawer.decidedHint : null;
  const chooseButton = (code: string, codeName: string) => (
    <Button size="sm" disabled={!pending} onClick={() => onChoose(code, codeName)} aria-label={`${x.drawer.choose}: ${code}`}>{ta.drawer.choose}</Button>
  );
  // The header pairs the current code with what would replace it: the reviewer's choice, the
  // suggestion, or a privileged code the check found.
  const proposal = detail.chosen ?? (suggesting ? (detail.noSuggestion ? null : detail.suggested) : detail.opportunity);
  const proposalLabel = detail.chosen ? x.act.chosen : detail.opportunity && !suggesting ? x.drawer.opportunity : u.suggested;
  const showMatch = suggesting && !detail.noSuggestion && (detail.confidence !== null || detail.stage === 'barcode' || detail.stage === 'dictionary');
  const sections = useMemo(() => [
    { key: 'details' as SectionKey, label: u.details },
    { key: 'evidence' as SectionKey, label: u.evidenceShort },
    { key: 'comments' as SectionKey, label: u.comments, count: row.comments },
    { key: 'history' as SectionKey, label: u.history },
  ], [u, row.comments]);

  return (
    <div ref={rootRef} className="@container space-y-6">
      <header className="space-y-3">
        <div>
          <h3 className="break-words text-section text-fg">{name || '—'}</h3>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <StatusChip tone={tone} icon={<StatusIcon tone={tone} size={12} />}>{typeLabels(t)[detail.type] ?? detail.type}</StatusChip>
            {/* The badge is the row's markingRequired, as in the grid and the filter; a marked suggestion too weak to count is only mentioned. */}
            {row.marking ? <Badge tone="warn">{ta.drawer.markirovka}</Badge> : detail.markingSuggested ? <Badge tone="neutral">{ta.drawer.markirovkaSuggested}</Badge> : null}
            {detail.privileges.length > 0 && !PRIVILEGE_TYPES.has(detail.type) ? <Badge tone="info">{ta.drawer.privilege}</Badge> : null}
          </div>
        </div>
        <CodePair
          left={{ label: u.current, view: detail.current, empty: x.noCode }}
          right={{
            label: proposalLabel, view: proposal,
            empty: suggesting && detail.noSuggestion ? x.noSuggestion : x.check[detail.type] ?? '—',
            extra: showMatch && !detail.chosen ? (
              <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <ConfidenceMeter confidence={detail.confidence} stage={detail.stage} show />
                {score ? (
                  <span className="inline-flex items-center gap-1 text-micro text-muted">
                    {x.match.score(score)}
                    <Tooltip content={ta.matchX.scoreHint} describe={false}>
                      <button type="button" aria-label={ta.matchX.scoreHint} className="grid size-6 place-items-center rounded-sm text-muted hover:bg-surface hover:text-fg">
                        <IconInfo size={14} />
                      </button>
                    </Tooltip>
                  </span>
                ) : null}
              </span>
            ) : null,
          }}
        />
      </header>

      <div>
        <SectionNav findingId={detail.findingId} items={sections} root={rootRef} />
        <div className="space-y-8">
          <DrawerSection findingId={detail.findingId} section="details" title={u.details}>
            <section className="space-y-1 rounded-lg border border-line bg-surface p-3">
              <h4 className="text-small font-semibold text-fg">{x.reasonTitle}</h4>
              {lines.map((line, i) => <p key={line} className={i === 0 ? 'text-small text-fg' : 'text-small text-muted'}>{line}</p>)}
              {detail.privileges.length > 0 ? (
                <div className="pt-1">
                  <p className="text-micro font-medium text-muted">{x.reason.privileges}</p>
                  <ul className="mt-1 list-disc space-y-1 pl-5 text-small text-fg">
                    {detail.privileges.map((p) => <li key={p} className="break-words">{p}</li>)}
                  </ul>
                </div>
              ) : null}
              {/* The audit stored its own Uzbek sentence; kept for the record, folded away, for Uzbek readers. */}
              {locale === 'uz' && detail.reason ? (
                <details className="pt-1 text-micro text-muted">
                  <summary className="cursor-pointer">{x.reasonAudit}</summary>
                  <p className="mt-1 break-words">{detail.reason}</p>
                </details>
              ) : null}
            </section>
            {!suggesting && x.confirmMeans[detail.type] && detail.mode === 'confirm' ? <p className="rounded-lg bg-info-tint p-3 text-small text-info-ink">{x.confirmMeans[detail.type]}</p> : null}
            <dl className="grid grid-cols-2 gap-3">
              <Meta label={ta.drawer.unit} value={detail.unit} />
              <Meta label={ta.drawer.barcode} value={detail.barcode} />
            </dl>
            {detail.nameOffer ? <NameFromBarcodeOffer findingId={detail.findingId} offer={detail.nameOffer} readOnly={readOnly} onFilled={setName} /> : null}
            <UnitAdviceBox advice={detail.advice} labels={detail.labels} />
          </DrawerSection>

          <DrawerSection findingId={detail.findingId} section="evidence" title={u.evidence}>
            <CodeCompare title={ta.drawer.current} view={detail.current} other={suggesting ? detail.suggested : detail.opportunity} empty={x.noCode} />
            {suggesting && detail.noSuggestion ? <p className="rounded-lg bg-surface p-3 text-small text-muted">{x.noSuggestionWhy}</p> : null}
            {suggesting && !detail.noSuggestion ? <CodeCompare title={ta.drawer.suggested} view={detail.suggested} other={detail.current} empty="—" /> : null}
            {detail.opportunity ? (
              <CodeCompare
                title={x.drawer.opportunity} view={detail.opportunity} other={detail.current} empty="—"
                action={readOnly ? null : chooseButton(detail.opportunity.code, detail.opportunity.name)}
              />
            ) : null}
            {detail.chosen ? <CodeCompare title={x.act.chosen} view={detail.chosen} other={detail.current} empty="—" /> : null}

            <SignalList signals={detail.signals} />

            {suggesting ? (
              <section>
                <h4 className="mb-2 text-small font-semibold text-fg">{x.drawer.alternatives}</h4>
                {detail.alternatives.length > 0 && whyNoPick ? <p className="mb-2 text-micro text-muted">{whyNoPick}</p> : null}
                {detail.alternatives.length === 0 ? <p className="text-small text-muted">{x.drawer.noAlternatives}</p> : (
                  <ul className="divide-y divide-line rounded-lg border border-line">
                    {detail.alternatives.map((a) => (
                      <li key={a.code} className="flex items-center gap-3 px-3 py-2.5">
                        <span className="min-w-0 flex-1">
                          {a.path ? <span className="block truncate text-micro text-muted" title={a.path}>{a.path}</span> : null}
                          <CodeChip code={a.code} />
                          <span className="mt-0.5 block truncate text-small text-fg" title={a.name}>{a.name}</span>
                        </span>
                        {chooseButton(a.code, a.name)}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            ) : null}

            {pending ? (
              <section>
                <h4 className="mb-2 text-small font-semibold text-fg">{x.drawer.searchTitle}</h4>
                <CodeSearch ref={searchRef} disabled={!pending} onPick={onChoose} />
              </section>
            ) : null}

            {showRequest || (!readOnly && suggesting && !detail.noSuggestion && detail.suggested) || (canSplit && !readOnly) ? (
              <div className="flex flex-wrap items-start gap-x-3 gap-y-2 border-t border-line pt-4">
                {showRequest ? <RequestText findingId={detail.findingId} readOnly={readOnly} /> : null}
                {!readOnly && suggesting && !detail.noSuggestion && detail.suggested ? <WrongFeedback findingId={detail.findingId} /> : null}
                {canSplit && !readOnly ? (
                  <span className="flex flex-col gap-1">
                    <Button size="sm" variant="ghost" onClick={onSplit}>{x.group.split}</Button>
                    <span className="max-w-xs text-micro text-muted">{x.group.splitHint}</span>
                  </span>
                ) : null}
              </div>
            ) : null}
          </DrawerSection>

          <DrawerSection findingId={detail.findingId} section="comments" title={u.comments}>
            <RowComments findingId={detail.findingId} flag={row.flag} readOnly={readOnly} onChange={onComments} />
          </DrawerSection>

          <DrawerSection findingId={detail.findingId} section="history" title={u.history} className="pb-4">
            {row.decision === 'pending' ? <p className="text-small text-muted">{u.noHistory}</p> : <DecisionInfo row={row} detail={detail} />}
          </DrawerSection>
        </div>
      </div>
    </div>
  );
}
