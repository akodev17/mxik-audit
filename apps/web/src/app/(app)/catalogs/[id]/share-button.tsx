'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { isApiError } from '@tasnivo/api-client';
import { api } from '@/lib/api/browser';
import { catalogKeys } from '@/lib/catalogs/client';
import type { ShareRow } from '@/lib/catalogs/types';
import { fmtDate } from '@tasnivo/i18n/format';
import { useI18n } from '@/lib/locale-client';
import { StatusChip, StatusIcon } from '@/ui/badge';
import { Button } from '@/ui/button';
import { Checkbox } from '@/ui/checkbox';
import { ConfirmDialog } from '@/ui/confirm-dialog';
import { CopyField } from '@/ui/copy-field';
import { Dialog } from '@/ui/dialog';
import { IconUsers } from '@/ui/icons';
import { Select } from '@/ui/select';
import { Skeleton } from '@/ui/skeleton';

/** Create, copy and revoke read-only report links for this catalogue, in one dialog. */
export function ShareButton({ catalogId, size }: { catalogId: string; size?: 'sm' }) {
  const { ta, locale } = useI18n();
  const s = ta.share;
  const w = ta.importX.flow.share;
  const date = (iso: string): string => fmtDate(locale, iso);
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [days, setDays] = useState<7 | 30>(7);
  const [pdf, setPdf] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<ShareRow | null>(null);
  const queryClient = useQueryClient();
  const key = catalogKeys.shareLinks(catalogId);

  // Read each time the dialog opens.
  const list = useQuery({ queryKey: key, queryFn: () => api.catalogs.shareLinks({ catalogId }), enabled: open, staleTime: 0, retry: false });
  const links = list.data ?? [];
  const listError = list.isError ? ta.wsX.toast.network : null;

  const creator = useMutation({
    mutationFn: () => api.catalogs.createShareLink({ catalogId, days, includePdf: pdf }),
    onMutate: () => setError(null),
    onSuccess: async (result) => {
      if (!result) { setError(ta.wsX.toast.failed); return; }
      setUrl(result.url);
      await queryClient.invalidateQueries({ queryKey: key });
    },
    // A plan without client links answers 403 plan_feature with the sentence to show.
    onError: (e) => setError(isApiError(e) && e.code === 'plan_feature' ? e.message : ta.wsX.toast.network),
  });
  const busy = creator.isPending;

  const close = (): void => {
    setOpen(false);
    // The link is shown once: closing the dialog forgets it.
    setUrl(null);
    setError(null);
  };

  return (
    <div className="no-print">
      <Button size={size} onClick={() => setOpen(true)} aria-haspopup="dialog"><IconUsers size={16} />{s.button}</Button>
      <Dialog
        open={open} onClose={close} title={s.title} description={s.hint} size="md"
        footer={<Button onClick={close}>{w.close}</Button>}
      >
        <div className="space-y-5">
          <section aria-labelledby="share-new" className="rounded-md bg-surface p-4">
            <h3 id="share-new" className="text-data font-semibold">{w.newLink}</h3>
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <Select label={s.valid.replace(/:$/, '')} size="compact" value={days} wrapperClassName="w-32" onChange={(e) => setDays(e.target.value === '30' ? 30 : 7)}>
                <option value={7}>{s.days(7)}</option><option value={30}>{s.days(30)}</option>
              </Select>
              <div className="flex h-control-compact items-center"><Checkbox label={s.withPdf} checked={pdf} onChange={(e) => setPdf(e.target.checked)} /></div>
              <Button size="sm" variant="primary" className="ml-auto" loading={busy} onClick={() => creator.mutate()}>{s.create}</Button>
            </div>
            {error ?? listError ? <p role="alert" className="mt-2 text-small text-danger-ink">{error ?? listError}</p> : null}
            {url ? <div className="mt-3"><CopyField label={s.created} value={url} size="compact" /></div> : null}
          </section>

          <section aria-labelledby="share-links">
            <h3 id="share-links" className="text-data font-semibold">{w.links}</h3>
            {list.isPending && open ? (
              <div className="mt-2 space-y-2"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>
            ) : links.length === 0 ? (
              <p className="mt-1 text-small text-muted">{w.noLinks}</p>
            ) : (
              <ul className="mt-2 divide-y divide-line border-y border-line text-small">
                {links.map((l) => {
                  const revoked = l.revokedAt !== null;
                  const dead = revoked || new Date(l.expiresAt) < new Date();
                  const tone = dead ? 'neutral' : 'good';
                  return (
                    <li key={l.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2.5">
                      <span className="min-w-0">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className={dead ? 'tabular-nums text-muted line-through decoration-subtle' : 'tabular-nums font-medium text-fg'}>{w.period(date(l.createdAt), date(l.expiresAt))}</span>
                          <StatusChip tone={tone} icon={<StatusIcon tone={tone} size={12} />}>{revoked ? s.revoked : dead ? s.expired : w.active}</StatusChip>
                        </span>
                        <span className="mt-0.5 block text-micro text-muted">{s.views(l.views, l.lastViewedAt ? date(l.lastViewedAt) : null)}{l.includePdf ? ' · PDF' : ''}</span>
                      </span>
                      {dead ? null : <Button size="compact" variant="danger-ghost" onClick={() => setRevoking(l)}>{s.revoke}</Button>}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      </Dialog>
      <ConfirmDialog
        open={revoking !== null} onClose={() => setRevoking(null)} tone="danger"
        title={ta.wsX.shareRevoke.title} description={ta.wsX.shareRevoke.body} scope={revoking ? w.period(date(revoking.createdAt), date(revoking.expiresAt)) : undefined}
        confirmLabel={ta.wsX.shareRevoke.title} cancelLabel={ta.wsX.shareRevoke.keep}
        onConfirm={async () => {
          if (!revoking) return { ok: true };
          const revoked = await api.catalogs.revokeShareLink({ linkId: revoking.id }).catch(() => false);
          if (!revoked) return { ok: false, error: ta.wsX.toast.failed };
          await queryClient.invalidateQueries({ queryKey: key });
          return { ok: true };
        }}
      />
    </div>
  );
}
