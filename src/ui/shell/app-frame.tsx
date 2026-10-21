'use client';

import { Suspense, useCallback, useEffect, useId, useState, type ReactNode } from 'react';
import { setSidebar } from '@/app/actions/shell';
import { useI18n } from '@/lib/locale-client';
import type { ShellData } from '@/lib/shell-data';
import { Badge } from '../badge';
import { IconButton } from '../icon-button';
import { IconMenu } from '../icons';
import { ToastProvider } from '../toast';
import { ClientSwitcher } from './client-switcher';
import { CommandPalette } from './command-palette';
import { MobileNav } from './mobile-nav';
import { NotificationBell } from './notification-bell';
import { PlanBanner } from './plan-banner';
import type { SidebarPref } from './prefs';
import { ResponseNudge } from './response-nudge';
import { RouteBoundary } from './route-boundary';
import { NavigationWatchdog } from './same-route-links';
import { SearchButton } from './search-button';
import { isPaletteShortcut, isTypingTarget } from './shortcuts';
import { Sidebar } from './sidebar';
import { useMediaQuery } from './use-media-query';
import { UserMenu } from './user-menu';

type Props = { shell: ShellData; sidebar: SidebarPref; children: ReactNode };

/** Signed-in frame: skip link, navigation rail (or mobile menu), header, plan banner, main, palette. */
export function AppFrame({ shell, sidebar, children }: Props) {
  const { ta } = useI18n();
  const [pref, setPref] = useState<SidebarPref>(sidebar);
  const [menuOpen, setMenuOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const wide = useMediaQuery('(min-width: 1024px)', true);
  const expanded = pref === 'auto' ? wide : pref === 'expanded';
  const railId = useId();
  const menuId = useId();

  const toggleRail = (): void => {
    const next = expanded ? 'collapsed' : 'expanded';
    setPref(next);
    // A preference only: the rail has already changed, and a lost cookie just means the default next time.
    void setSidebar(next).catch(() => undefined);
  };
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const closePalette = useCallback(() => setPaletteOpen(false), []);

  // Capture phase, so page-level shortcut handlers cannot swallow the palette keys first.
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (!isPaletteShortcut(e, isTypingTarget(e.target))) return;
      // Another modal (or the palette itself) owns the keyboard.
      if (document.querySelector('.app [aria-modal="true"]')) return;
      e.preventDefault();
      setPaletteOpen(true);
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  return (
    <ToastProvider>
      <div className="relative flex h-dvh overflow-hidden bg-surface">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-toast focus:rounded-ctl focus:border focus:border-line-strong focus:bg-raised focus:px-3 focus:py-2 focus:text-data focus:font-medium focus:text-fg focus:shadow-pop"
        >
          {ta.shellX.skip}
        </a>
        <Sidebar id={railId} pref={pref} expanded={expanded} onToggle={toggleRail} canWrite={shell.canWrite} canTeam={shell.canManageTeam} />
        <MobileNav id={menuId} open={menuOpen} onClose={closeMenu} canWrite={shell.canWrite} canTeam={shell.canManageTeam} />
        {/* From md the workspace is one white sheet inset in the grey canvas, as the sidebar sits on the canvas itself. */}
        <div className="flex min-w-0 flex-1 flex-col md:py-2 md:pr-2 print:p-0">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-base md:rounded-lg md:border md:border-line md:shadow-sm print:border-0 print:shadow-none">
          <header className="no-print flex h-14 shrink-0 items-center gap-1.5 border-b border-line bg-base px-2 sm:gap-2 sm:px-4">
            <span className="flex shrink-0 md:hidden">
              <IconButton
                label={ta.shellX.nav.open}
                icon={<IconMenu />}
                size="md"
                onClick={() => setMenuOpen(true)}
                aria-haspopup="dialog"
                aria-expanded={menuOpen}
                aria-controls={menuOpen ? menuId : undefined}
                tooltipSide="bottom"
                tooltipAlign="start"
              />
            </span>
            {/* It reads the query (useSearchParams); the boundary keeps any static render of the frame valid. */}
            <Suspense fallback={null}>
              <ClientSwitcher clients={shell.clients} active={shell.activeClient} canAdd={shell.canWrite && !shell.demo} />
            </Suspense>
            <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-2">
              <SearchButton onOpen={() => setPaletteOpen(true)} expanded={paletteOpen} />
              {shell.demo ? <span className="hidden sm:inline-flex"><Badge tone="brand" title={ta.shell.demoTitle}>{ta.shell.demoPill}</Badge></span> : null}
              <NotificationBell initialUnread={shell.unread} />
              <UserMenu email={shell.email} />
            </div>
          </header>
          <PlanBanner plan={shell.plan} />
          <main id="main" tabIndex={-1} className="relative min-h-0 flex-1 overflow-y-auto outline-none"><RouteBoundary>{children}</RouteBoundary></main>
          </div>
        </div>
      </div>
      <Suspense fallback={null}>
        <NavigationWatchdog />
      </Suspense>
      <ResponseNudge />
      <CommandPalette
        open={paletteOpen}
        onClose={closePalette}
        canWrite={shell.canWrite}
        canTeam={shell.canManageTeam}
        clients={shell.clients}
        activeClientId={shell.activeClient?.id ?? null}
      />
    </ToastProvider>
  );
}
