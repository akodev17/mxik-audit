'use client';

import { useEffect, useState } from 'react';
import { loadRowDetail } from '@/app/actions/workspace';
import { ta } from '@/lib/i18n-app';
import type { RowDetail } from '@/lib/row-detail';
import type { GridRow } from '@/lib/workspace-rows';
import { Badge, StatusChip } from '@/ui/badge';
import { Button } from '@/ui/button';
import { CodeChip } from '@/ui/code-chip';
import { Drawer } from '@/ui/drawer';
import { confidenceView, TYPE_LABEL, typeTone } from '@/ui/labels';
import { Skeleton } from '@/ui/skeleton';
import { CodeCompare } from './code-compare';
import { CodeSearch } from './code-search';
import { RequestText } from './request-text';

type Props = {
  row: GridRow | null;
  onClose: () => void;
  onAccept: () => void;
  onReject: () => void;
  onUndo: () => void;
  onChoose: (code: string, name: string) => void;
  readOnly: boolean;
};

const SIGNAL_DOT = { good: 'bg-good', warn: 'bg-warn', bad: 'bg-danger', neutral: 'bg-line-strong' } as const;

function Meta({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="truncate text-sm font-medium">{value || ta.drawer.none}</dd>
    </div>
  );
}

function Body({ row, detail, onChoose, readOnly }: { row: GridRow; detail: RowDetail; onChoose: Props['onChoose']; readOnly: boolean }) {
  const pending = row.decision === 'pending' && !readOnly;
  const conf = confidenceView(detail.confidence, row.barcode || row.dictionary);
  const showRequest = detail.noSuggestion || row.decision === 'rejected';
  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-lg leading-snug">{detail.productName}</h3>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <StatusChip tone={typeTone(detail.type, row.severity)}>{TYPE_LABEL[detail.type] ?? detail.type}</StatusChip>
          {conf && !detail.noSuggestion ? <StatusChip tone={conf.tone} title={`${conf.percent}%`}>{conf.label}</StatusChip> : null}
          {row.dictionary ? <Badge tone="good">{ta.dict.badge}</Badge> : null}
          {detail.markingCurrent || detail.markingSuggested ? <Badge tone="warn">{ta.drawer.markirovka}</Badge> : null}
          {detail.privileges.length > 0 ? <Badge tone="good" title={detail.privileges.join('; ')}>{ta.drawer.privilege}</Badge> : null}
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-3">
          <Meta label={ta.drawer.unit} value={detail.unit} />
          <Meta label={ta.drawer.barcode} value={detail.barcode} />
        </dl>
      </div>

      <CodeCompare title={ta.drawer.current} view={detail.current} other={detail.suggested} empty={ta.ws.noCode} />
      {detail.noSuggestion
        ? <p className="rounded-ctl bg-surface p-3 text-sm text-muted">{ta.ws.noSuggestion}. {ta.drawer.whyNone}</p>
        : <CodeCompare title={ta.drawer.suggested} view={detail.suggested} other={detail.current} empty="—" />}

      {detail.signals.length > 0 ? (
        <section>
          <h3 className="mb-2 text-sm font-bold">{ta.drawer.why}</h3>
          <ul className="space-y-1.5">
            {detail.signals.map((s) => (
              <li key={`${s.label}:${s.text}`} className="flex items-start gap-2 text-sm">
                <span aria-hidden className={`mt-1.5 size-2 shrink-0 rounded-full ${SIGNAL_DOT[s.tone]}`} />
                <span><span className="font-medium">{s.label}.</span> <span className="text-muted">{s.text}</span></span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section>
        <h3 className="mb-2 text-sm font-bold">{ta.drawer.alternatives}</h3>
        {detail.alternatives.length === 0 ? <p className="text-sm text-muted">{ta.drawer.noAlternatives}</p> : (
          <ul className="divide-y divide-line rounded-ctl border border-line">
            {detail.alternatives.map((a) => (
              <li key={a.code} className="flex items-center gap-3 px-3 py-2">
                <span className="min-w-0 flex-1">
                  <CodeChip code={a.code} />
                  <span className="mt-0.5 block truncate text-sm" title={a.name}>{a.name}</span>
                </span>
                <Button size="sm" disabled={!pending} onClick={() => onChoose(a.code, a.name)}>{ta.drawer.choose}</Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="mb-2 text-sm font-bold">{ta.drawer.search}</h3>
        <CodeSearch disabled={!pending} onPick={onChoose} />
      </section>

      {showRequest ? <RequestText findingId={detail.findingId} /> : null}
    </div>
  );
}

/** Right-hand detail panel for the active row; the grid stays usable behind it. */
export function RowDrawer({ row, onClose, onAccept, onReject, onUndo, onChoose, readOnly }: Props) {
  const [detail, setDetail] = useState<RowDetail | null>(null);
  const [failed, setFailed] = useState(false);
  const id = row?.findingId ?? null;

  useEffect(() => {
    if (!id) return;
    let live = true;
    setDetail(null);
    setFailed(false);
    loadRowDetail(id).then((d) => { if (!live) return; if (d) setDetail(d); else setFailed(true); }).catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [id]);

  const pending = row?.decision === 'pending';
  const canAccept = pending && Boolean(row?.suggestedMxik) && !row?.noSuggestion;
  return (
    <Drawer
      open={row !== null}
      title={row ? `${ta.ws.colNo}${row.rowIndex + 1}` : ''}
      onClose={onClose}
      footer={row && !readOnly ? (
        <div className="flex items-center gap-2">
          {pending ? (
            <>
              <Button variant="primary" disabled={!canAccept} onClick={onAccept}>{ta.ws.accept}</Button>
              <Button variant="secondary" onClick={onReject}>{ta.ws.reject}</Button>
            </>
          ) : (
            <>
              <StatusChip tone={row.decision === 'accepted' ? 'good' : 'neutral'}>{row.decision === 'accepted' ? ta.ws.accepted : ta.ws.rejected}</StatusChip>
              <Button variant="secondary" onClick={onUndo}>{ta.ws.undo}</Button>
            </>
          )}
        </div>
      ) : null}
    >
      {row && detail ? <Body row={row} detail={detail} onChoose={onChoose} readOnly={readOnly} /> : null}
      {row && !detail && !failed ? (
        <div className="space-y-3" aria-busy="true"><Skeleton className="h-6 w-3/4" /><Skeleton className="h-40 w-full" /><Skeleton className="h-40 w-full" /></div>
      ) : null}
      {failed ? <p role="alert" className="text-sm text-danger">{ta.drawer.loadFailed}</p> : null}
    </Drawer>
  );
}
