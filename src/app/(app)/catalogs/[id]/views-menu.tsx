'use client';

import { useRouter, usePathname } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { viewsDefault, viewsList, viewsRemove, viewsSave } from '@/app/actions/views';
import { useI18n } from '@/lib/locale-client';
import { viewQuery, type ViewParams } from '@/lib/view-params';
import type { ViewRow } from '@/lib/views';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';

type Props = { current: ViewParams; canSave: boolean };

/** Quick access to saved views, and saving the current filters, sort, density and grouping. */
export function ViewsMenu({ current, canSave }: Props) {
  const { ta } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [views, setViews] = useState<ViewRow[]>([]);
  const [name, setName] = useState('');
  const [makeDefault, setMakeDefault] = useState(false);
  const [busy, start] = useTransition();

  useEffect(() => { if (open) void viewsList().then(setViews); }, [open]);

  const apply = (v: ViewRow): void => { setOpen(false); router.replace(`${pathname}?${viewQuery(v.params)}`, { scroll: false }); };
  const save = (): void => start(async () => { setViews(await viewsSave({ name, params: current, makeDefault })); setName(''); setMakeDefault(false); });

  return (
    <div className="relative">
      <Button size="sm" onClick={() => setOpen((o) => !o)} aria-expanded={open}>{ta.views.title}</Button>
      {open ? (
        <div className="absolute left-0 top-10 z-40 w-[340px] rounded-ctl border border-line bg-base p-3 shadow-pop">
          {views.length === 0 ? <p className="text-sm text-muted">{ta.views.none}</p> : (
            <ul className="divide-y divide-line">
              {views.map((v) => (
                <li key={v.id} className="flex items-center justify-between gap-2 py-1.5 text-sm">
                  <button type="button" onClick={() => apply(v)} className="min-w-0 truncate text-left font-medium hover:text-brand">
                    {v.name}{v.isDefault ? <span className="ml-2 text-xs font-normal text-muted">{ta.views.default}</span> : null}
                  </button>
                  <span className="flex shrink-0 gap-1">
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => start(async () => setViews(await viewsDefault(v.isDefault ? null : v.id)))}>
                      {v.isDefault ? ta.views.unsetDefault : ta.views.setDefault}
                    </Button>
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => start(async () => setViews(await viewsRemove(v.id)))} aria-label={ta.views.remove}>✕</Button>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {canSave ? (
            <div className="mt-3 space-y-2 border-t border-line pt-3">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={ta.views.namePlaceholder} maxLength={60} aria-label={ta.views.namePlaceholder} />
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={makeDefault} onChange={(e) => setMakeDefault(e.target.checked)} className="size-4 accent-[var(--color-brand)]" />{ta.views.makeDefault}</label>
              <Button size="sm" variant="primary" disabled={busy || name.trim().length === 0} onClick={save}>{ta.views.save}</Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
