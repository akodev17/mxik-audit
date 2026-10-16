'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { t } from '@/lib/i18n';
import { ta } from '@/lib/i18n-app';

/** Avatar button with email, settings and sign-out. */
export function UserMenu({ email }: { email: string }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent): void => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div ref={box} className="relative">
      <button
        type="button" onClick={() => setOpen((o) => !o)} aria-label={ta.shell.menu} aria-expanded={open}
        className="grid size-9 place-items-center rounded-full bg-brand-tint text-sm font-bold uppercase text-brand hover:bg-[#dbe6fd]"
      >
        {email.slice(0, 1)}
      </button>
      {open ? (
        <div className="absolute right-0 top-11 z-40 w-64 rounded-ctl border border-line bg-base py-1 shadow-pop">
          <p className="truncate border-b border-line px-3 py-2 text-sm text-muted">{email}</p>
          <Link href="/settings" onClick={() => setOpen(false)} className="block px-3 py-2 text-sm hover:bg-surface">{ta.nav.settings}</Link>
          <form action="/api/sign-out" method="post">
            <button type="submit" className="block w-full px-3 py-2 text-left text-sm hover:bg-surface">{t.signOut}</button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
