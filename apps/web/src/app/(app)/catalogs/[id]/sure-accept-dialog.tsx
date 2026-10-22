'use client';

import { useEffect, useState } from 'react';
import { acceptAllAbove, previewSure, type ManyOutcome, type SurePreviewResult } from '@/app/actions/review';
import { BANDS } from '@tasnivo/core/match/score';
import { fmtNumber } from '@tasnivo/i18n/format';
import { useI18n } from '@/lib/locale-client';
import { filterQuery, type WsFilter } from '@tasnivo/domain/workspace-filter';
import { Button } from '@/ui/button';
import { Dialog } from '@/ui/dialog';
import { IconError } from '@/ui/icons';
import { Segmented } from '@/ui/segmented';
import { Spinner } from '@/ui/spinner';
import { typeLabels } from '@/ui/labels';
import { count, skippedText } from './ws-text';
import { serverChange } from '@/ui/shell/router-cache';

type Props = {
  open: boolean;
  catalogId: string;
  filter: WsFilter;
  /** The filter narrows the catalogue (type, search, flag, comments), so offering it as a scope means something. */
  filterNarrows: boolean;
  onClose: () => void;
  onDone: (result: Extract<ManyOutcome, { ok: true }>) => void;
};

type Scope = 'catalogue' | 'filter';

/** Confirms "accept all high-match": scope, counts by type, what will be skipped; one undoable event. */
export function SureAcceptDialog({ open, catalogId, filter, filterNarrows, onClose, onDone }: Props) {
  const { t, ta, locale } = useI18n();
  const s = ta.wsX.sure;
  const [scope, setScope] = useState<Scope>('catalogue');
  const [preview, setPreview] = useState<SurePreviewResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const filterArg = scope === 'filter' ? filterQuery(filter) : null;
  const filterKey = JSON.stringify(filterArg);

  useEffect(() => {
    if (!open) return;
    let live = true;
    setPreview(null);
    setError(null);
    previewSure({ catalogId, filter: filterArg })
      .then((p) => { if (live) setPreview(p); })
      .catch(() => { if (live) setPreview({ ok: false, error: s.loadFailed }); });
    return () => { live = false; };
    // filterKey stands for filterArg's content.
  }, [open, catalogId, filterKey, s.loadFailed]);

  async function confirm(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const result = await serverChange(acceptAllAbove({ catalogId, minConfidence: BANDS.high, filter: filterArg }));
      if (!result.ok) { setError(result.error); return; }
      onDone(result);
      onClose();
    } catch {
      setError(ta.wsX.toast.network);
    } finally {
      setBusy(false);
    }
  }

  const ready = preview?.ok ? preview : null;
  const skipped = ready ? skippedText(ready.skipped, ta, locale) : null;
  return (
    <Dialog
      open={open} onClose={onClose} title={s.title} description={s.description} size="md" dismissible={!busy}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>{s.cancel}</Button>
          <Button variant="primary" loading={busy} disabled={!ready || ready.willAccept === 0} onClick={() => { void confirm(); }}>
            {count(locale, s.confirm, ready?.willAccept ?? 0)}
          </Button>
        </>
      )}
    >
      <div className="space-y-3 text-data">
        {filterNarrows ? (
          <Segmented<Scope>
            label={s.scope} value={scope} onChange={setScope} disabled={busy}
            options={[{ value: 'catalogue', label: s.scopeCatalogue }, { value: 'filter', label: s.scopeFilter }]}
          />
        ) : <p><span className="text-muted">{s.scope}: </span><span className="font-medium">{s.scopeCatalogue}</span></p>}
        {preview === null ? <Spinner label={s.loading} /> : null}
        {preview && !preview.ok ? <p role="alert" className="text-small text-danger-ink">{preview.error}</p> : null}
        {ready ? (
          ready.total === 0 ? <p className="text-muted">{s.none}</p> : (
            <>
              <p className="font-medium tabular-nums">{count(locale, s.willAccept, ready.willAccept)}</p>
              <div>
                <p className="text-small text-muted">{s.byType}</p>
                <ul className="mt-1 space-y-0.5 text-small">
                  {Object.entries(ready.byType).map(([type, n]) => (
                    <li key={type} className="flex justify-between gap-4"><span>{typeLabels(t)[type] ?? type}</span><span className="tabular-nums">{fmtNumber(locale, n)}</span></li>
                  ))}
                </ul>
              </div>
              {skipped ? <p className="text-small text-warn-ink">{skipped}</p> : null}
            </>
          )
        ) : null}
        <p className="text-micro text-muted">{s.excluded}</p>
        {error ? (
          <p role="alert" className="flex items-start gap-1.5 rounded-ctl bg-danger-tint px-3 py-2 text-small font-medium text-danger-ink">
            <IconError size={16} className="mt-px shrink-0" />{error}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
