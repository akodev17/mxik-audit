'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { fmtDate } from '@tasnivo/i18n/format';
import { api } from '@/lib/api/browser';
import { queryKey, useSeededQuery } from '@/lib/api/query';
import { useI18n } from '@/lib/locale-client';
import { Button } from '@/ui/button';
import { ConfirmDialog } from '@/ui/confirm-dialog';
import { IconDownload } from '@/ui/icons';
import { Select } from '@/ui/select';
import { useToast } from '@/ui/toast';
import type { Account } from './brand-form';

const FALLBACK_NAME = 'mxik-audit-export.zip';

/** Downloads the account zip with visible progress; a failed export says so instead of saving an error page. */
export function ExportButton() {
  const { ta } = useI18n();
  const s = ta.setX.data;
  const toast = useToast();
  const [failed, setFailed] = useState(false);
  const download = useMutation({
    mutationFn: () => api.account.exportZip(),
    onMutate: () => setFailed(false),
    onSuccess: ({ blob, filename }) => {
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename ?? FALLBACK_NAME;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      toast(s.exportDone);
    },
    onError: () => {
      setFailed(true);
      toast(s.exportFailed, { tone: 'error' });
    },
  });
  const busy = download.isPending;

  return (
    <div className="space-y-2">
      <Button variant="secondary" loading={busy} onClick={() => download.mutate()}><IconDownload size={16} />{busy ? s.exporting : s.exportButton}</Button>
      {failed ? <p role="alert" className="text-small text-danger-ink">{s.exportFailed}</p> : null}
    </div>
  );
}

const NEVER = 'never';
const daysOf = (value: string): number | null => (value === NEVER ? null : Number(value));
/** Shorter means more gets erased sooner: "keep" is the longest. */
const shortens = (from: number | null, to: number | null): boolean => to !== null && (from === null || to < from);

/** Raw-file retention. Shortening asks first; a failed save goes back to the saved value. */
export function RetentionSetting({ initial }: { initial: Account }) {
  const { locale, ta } = useI18n();
  const s = ta.setX.data;
  const toast = useToast();
  const queryClient = useQueryClient();
  const { data } = useSeededQuery(api.account.get, initial);
  const choices = data.retentionChoices;
  const since = data.rawRetentionSince ? fmtDate(locale, data.rawRetentionSince) : null;
  const [saved, setSaved] = useState<number | null>(data.rawRetentionDays);
  const [shown, setShown] = useState<string>(saved === null ? NEVER : String(saved));
  const [asking, setAsking] = useState<number | null>(null);
  const label = (days: number | null): string => (days === null ? s.keep : s.days(days));

  const change = useMutation({
    mutationFn: (days: number | null) => api.account.setRetention({ days }).catch(() => false),
    onSuccess: async (ok, days) => {
      if (!ok) return;
      setSaved(days);
      setShown(days === null ? NEVER : String(days));
      toast(s.saved);
      await queryClient.invalidateQueries({ queryKey: queryKey(api.account.get) });
    },
  });
  const save = (days: number | null): Promise<boolean> => change.mutateAsync(days);

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
      <Select label={s.retentionLabel} value={shown} disabled={change.isPending} onChange={(e) => choose(e.target.value)} wrapperClassName="max-w-xs">
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
