'use client';

import { useEffect, useState, useTransition } from 'react';
import { shareCreate, shareList, shareRevoke, type ShareRow } from '@/app/actions/share';
import { ta } from '@/lib/i18n-app';
import { Button } from '@/ui/button';

const date = (iso: string): string => new Date(iso).toLocaleDateString('uz-UZ');

/** Create, copy and revoke read-only report links for this catalogue. */
export function ShareButton({ catalogId }: { catalogId: string }) {
  const [open, setOpen] = useState(false);
  const [links, setLinks] = useState<ShareRow[]>([]);
  const [url, setUrl] = useState<string | null>(null);
  const [days, setDays] = useState<7 | 30>(7);
  const [pdf, setPdf] = useState(true);
  const [busy, start] = useTransition();

  useEffect(() => { if (open) void shareList(catalogId).then(setLinks); }, [open, catalogId]);

  const create = (): void => start(async () => {
    const result = await shareCreate({ catalogId, days, includePdf: pdf });
    setUrl(result?.url ?? null);
    setLinks(await shareList(catalogId));
  });

  return (
    <div className="no-print relative">
      <Button onClick={() => setOpen((o) => !o)} aria-expanded={open}>{ta.share.button}</Button>
      {open ? (
        <div className="absolute right-0 top-12 z-40 w-[380px] rounded-ctl border border-line bg-base p-4 shadow-pop">
          <h3 className="text-base">{ta.share.title}</h3>
          <p className="mt-1 text-xs text-muted">{ta.share.hint}</p>
          <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
            <label className="flex items-center gap-1.5">{ta.share.valid}
              <select value={days} onChange={(e) => setDays(e.target.value === '30' ? 30 : 7)} className="h-8 rounded-ctl border border-line-strong bg-base px-2">
                <option value={7}>{ta.share.days(7)}</option><option value={30}>{ta.share.days(30)}</option>
              </select>
            </label>
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={pdf} onChange={(e) => setPdf(e.target.checked)} className="size-4 accent-[var(--color-brand)]" />{ta.share.withPdf}</label>
            <Button size="sm" variant="primary" disabled={busy} onClick={create}>{ta.share.create}</Button>
          </div>
          {url ? (
            <div className="mt-3 rounded-ctl bg-good-tint px-3 py-2 text-sm">
              <p className="font-medium">{ta.share.created}</p>
              <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} className="mt-1 w-full rounded border border-line-strong bg-base px-2 py-1 text-xs" />
            </div>
          ) : null}
          {links.length > 0 ? (
            <ul className="mt-3 divide-y divide-line text-sm">
              {links.map((l) => {
                const dead = l.revokedAt !== null || new Date(l.expiresAt) < new Date();
                return (
                  <li key={l.id} className="flex items-center justify-between gap-2 py-2">
                    <span className={dead ? 'text-muted' : ''}>
                      {date(l.createdAt)} → {date(l.expiresAt)}
                      <span className="block text-xs text-muted">{ta.share.views(l.views, l.lastViewedAt ? date(l.lastViewedAt) : null)}{l.revokedAt ? `, ${ta.share.revoked}` : dead ? `, ${ta.share.expired}` : ''}</span>
                    </span>
                    {dead ? null : <Button size="sm" variant="danger" disabled={busy} onClick={() => start(async () => { await shareRevoke(l.id); setLinks(await shareList(catalogId)); })}>{ta.share.revoke}</Button>}
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
