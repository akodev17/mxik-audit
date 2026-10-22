'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, useTransition } from 'react';
import { api } from '@/lib/api/browser';
import { isNetworkFailure } from '@/lib/api-failure';
import { useI18n } from '@/lib/locale-client';
import { viewQuery, type ViewParams } from '@/lib/workspace-url';
import { Button } from '@/ui/button';
import { Checkbox } from '@/ui/checkbox';
import { IconButton } from '@/ui/icon-button';
import { IconX } from '@/ui/icons';
import { Input } from '@/ui/input';
import { Popover } from '@/ui/popover';
import { Spinner } from '@/ui/spinner';
import { useToast } from '@/ui/toast';
import type { ViewRow } from './ws-types';

type ViewsResult = { ok: boolean; views: ViewRow[] };

const VIEWS = ['views'] as const;

type Props = {
  current: ViewParams;
  /** Null when the user may save; otherwise why not (viewer, demo). */
  saveBlocked: string | null;
  /** Applies density, grouping and columns at once; the filters follow through the URL. */
  onApply: (params: ViewParams) => void;
};

/** Saved views: open one, or save the current filters, sort, density, grouping and columns. */
export function ViewsMenu({ current, saveBlocked, onApply }: Props) {
  const { ta } = useI18n();
  const toast = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  // Read afresh each time the menu opens, as before; saving answers the new list.
  const list = useQuery({
    queryKey: VIEWS,
    queryFn: ({ signal }) => api.workspace.views(undefined, { signal }),
    enabled: open,
    staleTime: 0,
    retry: false,
  });
  const views = list.data ?? null;
  const failed = list.isError && views === null;
  const [name, setName] = useState('');
  const [makeDefault, setMakeDefault] = useState(false);
  const [busy, start] = useTransition();

  const run = (call: () => Promise<ViewsResult>, done?: string): void => start(async () => {
    try {
      const result = await call();
      queryClient.setQueryData<ViewRow[]>(VIEWS, result.views);
      if (!result.ok) { toast(ta.wsX.view.saveFailed, { tone: 'error' }); return; }
      if (done) toast(done);
      setName('');
      setMakeDefault(false);
    } catch (error) {
      toast(isNetworkFailure(error) ? ta.wsX.toast.network : ta.wsX.view.saveFailed, { tone: 'error' });
    }
  });

  const apply = (v: ViewRow): void => {
    setOpen(false);
    onApply(v.params);
    router.replace(`${pathname}?${viewQuery(v.params)}`, { scroll: false });
  };

  return (
    <Popover label={ta.views.title} size="sm" align="end" open={open} onOpenChange={setOpen} panelClassName="w-[min(22rem,calc(100vw-2rem))]">
      {views === null && !failed ? <Spinner label={ta.wsX.drawer.loading} /> : null}
      {failed ? <p role="alert" className="text-small text-danger-ink">{ta.wsX.toast.network}</p> : null}
      {views !== null && views.length === 0 ? <p className="text-small text-muted">{ta.views.none}</p> : null}
      {views !== null && views.length > 0 ? (
        <ul className="divide-y divide-line">
          {views.map((v) => (
            <li key={v.id} className="flex items-center justify-between gap-2 py-1.5 text-small">
              <button type="button" onClick={() => apply(v)} className="min-w-0 truncate text-left font-medium text-fg hover:text-brand-ink">
                {v.name}{v.isDefault ? <span className="ml-2 text-micro font-normal text-muted">{ta.views.default}</span> : null}
              </button>
              {saveBlocked ? null : (
                <span className="flex shrink-0 items-center gap-1">
                  <Button size="compact" variant="ghost" disabled={busy} onClick={() => run(() => api.workspace.setDefaultView({ viewId: v.isDefault ? null : v.id }))}>
                    {v.isDefault ? ta.views.unsetDefault : ta.views.setDefault}
                  </Button>
                  <IconButton size="compact" variant="danger-ghost" label={`${ta.views.remove}: ${v.name}`} icon={<IconX size={14} />} disabled={busy} onClick={() => run(() => api.workspace.removeView({ viewId: v.id }))} />
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      {saveBlocked ? <p className="mt-3 border-t border-line pt-3 text-micro text-muted">{saveBlocked}</p> : (
        <form
          className="mt-3 space-y-2 border-t border-line pt-3"
          onSubmit={(e) => { e.preventDefault(); if (name.trim()) run(() => api.workspace.saveView({ name, params: current, makeDefault }), ta.wsX.view.saved); }}
        >
          <Input size="compact" value={name} onChange={(e) => setName(e.target.value)} placeholder={ta.views.namePlaceholder} maxLength={60} aria-label={ta.views.namePlaceholder} />
          <Checkbox label={ta.views.makeDefault} checked={makeDefault} onChange={(e) => setMakeDefault(e.target.checked)} />
          <Button type="submit" size="sm" variant="primary" loading={busy} disabled={name.trim().length === 0}>{ta.views.save}</Button>
        </form>
      )}
    </Popover>
  );
}
