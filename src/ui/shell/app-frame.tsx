'use client';

import Link from 'next/link';
import { Suspense, useEffect, useState, type ReactNode } from 'react';
import type { ShellData } from '@/lib/shell-data';
import { ta } from '@/lib/i18n-app';
import { Badge } from '../badge';
import { IconBell } from '../icons';
import { ToastProvider } from '../toast';
import { ClientSwitcher } from './client-switcher';
import { GlobalSearch } from './global-search';
import { Sidebar } from './sidebar';
import { UserMenu } from './user-menu';

const STORE_KEY = 'mxik.sidebar.collapsed';

export function AppFrame({ shell, children }: { shell: ShellData; children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try { setCollapsed(localStorage.getItem(STORE_KEY) === '1'); } catch { /* storage blocked */ }
  }, []);

  function toggle(): void {
    setCollapsed((c) => {
      try { localStorage.setItem(STORE_KEY, c ? '0' : '1'); } catch { /* storage blocked */ }
      return !c;
    });
  }

  return (
    <ToastProvider>
      <div className="flex h-screen overflow-hidden">
        <Sidebar collapsed={collapsed} onToggle={toggle} canWrite={shell.canWrite} />
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="no-print flex h-14 shrink-0 items-center gap-3 border-b border-line bg-base px-4">
            <ClientSwitcher clients={shell.clients} active={shell.activeClient} />
            <Suspense fallback={<div className="h-9 w-full max-w-md" />}>
              <GlobalSearch latestCatalogId={shell.latestCatalogId} />
            </Suspense>
            <div className="ml-auto flex items-center gap-2">
              {shell.demo ? <Badge tone="brand" title={ta.shell.demoTitle}>{ta.shell.demoPill}</Badge> : null}
              <Link href="/notifications" aria-label={ta.shell.notifications} className="relative grid size-9 place-items-center rounded-ctl text-muted hover:bg-surface hover:text-fg">
                <IconBell />
                {shell.unread > 0 ? (
                  <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-danger px-1 text-[10px] font-bold text-white">
                    {shell.unread > 99 ? '99+' : shell.unread}
                  </span>
                ) : null}
              </Link>
              <UserMenu email={shell.email} />
            </div>
          </header>
          <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
        </div>
      </div>
    </ToastProvider>
  );
}
