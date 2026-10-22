'use client';

import { useEffect, useState } from 'react';
import { shareCreate, shareList, shareRevoke, type ShareRow } from '@/app/actions/share';
import { fmtDate } from '@tasnivo/i18n/format';
import { useI18n } from '@/lib/locale-client';
import { Button } from '@/ui/button';
import { Checkbox } from '@/ui/checkbox';
import { ConfirmDialog } from '@/ui/confirm-dialog';
import { CopyField } from '@/ui/copy-field';
import { Popover } from '@/ui/popover';
import { Select } from '@/ui/select';

/** Create, copy and revoke read-only report links for this catalogue. */
export function ShareButton({ catalogId }: { catalogId: string }) {
  const { ta, locale } = useI18n();
  const s = ta.share;
  const date = (iso: string): string => fmtDate(locale, iso);
  const [open, setOpen] = useState(false);
  const [links, setLinks] = useState<ShareRow[]>([]);
  const [url, setUrl] = useState<string | null>(null);
  const [days, setDays] = useState<7 | 30>(7);
  const [pdf, setPdf] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<ShareRow | null>(null);

  const refresh = async (): Promise<void> => {
    try { setLinks(await shareList(catalogId)); } catch { setError(ta.wsX.toast.network); }
  };
  useEffect(() => { if (open) void refresh(); }, [open, catalogId]);

  async function create(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const result = await shareCreate({ catalogId, days, includePdf: pdf });
      if (!result) { setError(ta.wsX.toast.failed); return; }
      setUrl(result.url);
      await refresh();
    } catch {
      setError(ta.wsX.toast.network);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="no-print">
      <Popover label={s.button} title={s.title} open={open} onOpenChange={setOpen} align="end" panelClassName="w-[min(24rem,calc(100vw-2rem))]">
        <h3 className="text-section text-fg">{s.title}</h3>
        <p className="mt-1 text-micro text-muted">{s.hint}</p>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-small">
          <label className="flex items-center gap-1.5 text-muted">{s.valid}
            <Select size="compact" value={days} onChange={(e) => setDays(e.target.value === '30' ? 30 : 7)}>
              <option value={7}>{s.days(7)}</option><option value={30}>{s.days(30)}</option>
            </Select>
          </label>
          <Checkbox label={s.withPdf} checked={pdf} onChange={(e) => setPdf(e.target.checked)} />
          <Button size="sm" variant="primary" loading={busy} onClick={() => { void create(); }}>{s.create}</Button>
        </div>
        {error ? <p role="alert" className="mt-2 text-small text-danger-ink">{error}</p> : null}
        {url ? <div className="mt-3"><CopyField label={s.created} value={url} size="compact" /></div> : null}
        {links.length > 0 ? (
          <ul className="mt-3 divide-y divide-line text-small">
            {links.map((l) => {
              const dead = l.revokedAt !== null || new Date(l.expiresAt) < new Date();
              return (
                <li key={l.id} className="flex items-center justify-between gap-2 py-2">
                  <span className={dead ? 'text-muted' : 'text-fg'}>
                    {date(l.createdAt)} → {date(l.expiresAt)}
                    <span className="block text-micro text-muted">{s.views(l.views, l.lastViewedAt ? date(l.lastViewedAt) : null)}{l.revokedAt ? `, ${s.revoked}` : dead ? `, ${s.expired}` : ''}</span>
                  </span>
                  {dead ? null : <Button size="compact" variant="danger-ghost" onClick={() => setRevoking(l)}>{s.revoke}</Button>}
                </li>
              );
            })}
          </ul>
        ) : null}
      </Popover>
      <ConfirmDialog
        open={revoking !== null} onClose={() => setRevoking(null)} tone="danger"
        title={ta.wsX.shareRevoke.title} description={ta.wsX.shareRevoke.body} scope={revoking ? `${date(revoking.createdAt)} → ${date(revoking.expiresAt)}` : undefined}
        confirmLabel={ta.wsX.shareRevoke.title} cancelLabel={ta.wsX.shareRevoke.keep}
        onConfirm={async () => {
          if (!revoking) return { ok: true };
          if (!(await shareRevoke(revoking.id))) return { ok: false, error: ta.wsX.toast.failed };
          await refresh();
          return { ok: true };
        }}
      />
    </div>
  );
}
