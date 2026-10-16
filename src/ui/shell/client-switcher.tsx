'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { rememberClient } from '@/app/actions/clients';
import { ta } from '@/lib/i18n-app';
import { IconChevron } from '../icons';

type Props = { clients: { id: string; name: string }[]; active: { id: string; name: string } };

/** Switches which client the app works on; opens as a small popover. */
export function ClientSwitcher({ clients, active }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [, start] = useTransition();
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent): void => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  function pick(id: string): void {
    setOpen(false);
    if (id === active.id) return;
    start(async () => {
      await rememberClient(id);
      router.push('/catalogs');
      router.refresh();
    });
  }

  return (
    <div ref={box} className="relative">
      <button
        type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="listbox"
        className="flex h-9 max-w-[220px] items-center gap-2 rounded-ctl border border-line-strong bg-base px-3 text-sm font-medium hover:bg-surface"
      >
        <span className="text-muted">{ta.shell.client}</span>
        <span className="truncate">{active.name}</span>
        <span className="rotate-90 text-muted"><IconChevron /></span>
      </button>
      {open ? (
        <div className="absolute left-0 top-11 z-40 w-64 rounded-ctl border border-line bg-base py-1 shadow-pop">
          <ul role="listbox" className="max-h-72 overflow-y-auto">
            {clients.map((c) => (
              <li key={c.id}>
                <button
                  type="button" role="option" aria-selected={c.id === active.id} onClick={() => pick(c.id)}
                  className={`block w-full truncate px-3 py-2 text-left text-sm hover:bg-surface ${c.id === active.id ? 'font-bold text-brand' : ''}`}
                >
                  {c.name}
                </button>
              </li>
            ))}
          </ul>
          <Link href="/clients" onClick={() => setOpen(false)} className="block border-t border-line px-3 py-2 text-sm text-brand hover:bg-surface">
            {ta.shell.addClient}
          </Link>
        </div>
      ) : null}
    </div>
  );
}
