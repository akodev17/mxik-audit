'use client';

import { useState } from 'react';
import { changeRetention } from '@/app/actions/security';
import { useI18n } from '@/lib/locale-client';
import { Button } from '@/ui/button';
import { ConfirmDialog } from '@/ui/confirm-dialog';
import { IconDownload } from '@/ui/icons';
import { Select } from '@/ui/select';
import { useToast } from '@/ui/toast';

const FALLBACK_NAME = 'mxik-audit-export.zip';

/** The filename the server suggests in Content-Disposition. */
function fileNameOf(response: Response): string {
  const header = response.headers.get('content-disposition') ?? '';
  return /filename="?([^";]+)"?/i.exec(header)?.[1] ?? FALLBACK_NAME;
}

/** Downloads the account zip with visible progress; a failed export says so instead of saving an error page. */
export function ExportButton() {
  const { ta } = useI18n();
  const s = ta.setX.data;
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const download = async (): Promise<void> => {
    setBusy(true);
    setFailed(false);
    try {
      const response = await fetch('/api/account/export', { credentials: 'same-origin' });
      if (!response.ok) throw new Error(String(response.status));
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = fileNameOf(response);
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      toast(s.exportDone);
    } catch {
      setFailed(true);
      toast(s.exportFailed, { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <Button variant="secondary" loading={busy} onClick={() => void download()}><IconDownload size={16} />{busy ? s.exporting : s.exportButton}</Button>
      {failed ? <p role="alert" className="text-small text-danger-ink">{s.exportFailed}</p> : null}
    </div>
  );
}

const NEVER = 'never';
const daysOf = (value: string): number | null => (value === NEVER ? null : Number(value));
/** Shorter means more gets erased sooner: "keep" is the longest. */
const shortens = (from: number | null, to: number | null): boolean => to !== null && (from === null || to < from);

type RetentionProps = { value: number | null; choices: readonly number[]; since: string | null };

/** Raw-file retention. Shortening asks first; a failed save goes back to the saved value. */
export function RetentionSetting({ value, choices, since }: RetentionProps) {
  const { ta } = useI18n();
  const s = ta.setX.data;
  const toast = useToast();
  const [saved, setSaved] = useState<number | null>(value);
  const [shown, setShown] = useState<string>(value === null ? NEVER : String(value));
  const [asking, setAsking] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const label = (days: number | null): string => (days === null ? s.keep : s.days(days));

  const save = async (days: number | null): Promise<boolean> => {
    setBusy(true);
    const ok = await changeRetention(days).catch(() => false);
    setBusy(false);
    if (ok) {
      setSaved(days);
      setShown(days === null ? NEVER : String(days));
      toast(s.saved);
    }
    return ok;
  };

  const choose = (next: string): void => {
    const days = daysOf(next);
    if (days === saved) return;
    if (shortens(saved, days)) { setAsking(days); return; }
    setShown(next);
    void save(days).then((ok) => {
      if (ok) return;
      setShown(saved === null ? NEVER : String(saved));
      toast(s.failed, { tone: 'error' });
    });
  };

  return (
    <div className="max-w-xl space-y-2">
      <Select label={s.retentionLabel} value={shown} disabled={busy} onChange={(e) => choose(e.target.value)} wrapperClassName="max-w-xs">
        {choices.map((n) => <option key={n} value={String(n)}>{s.days(n)}</option>)}
        <option value={NEVER}>{s.keep}</option>
      </Select>
      {since ? <p className="text-small text-muted">{s.retentionSince(since)}</p> : null}
      <ConfirmDialog
        open={asking !== null} onClose={() => setAsking(null)} tone="danger"
        title={s.shortenTitle(label(asking))} description={s.shortenText(since ?? '—')}
        confirmLabel={s.shortenConfirm}
        onConfirm={async () => ((await save(asking)) ? { ok: true } : { ok: false, error: s.failed })}
      />
    </div>
  );
}
