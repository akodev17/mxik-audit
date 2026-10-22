'use client';

import Link from 'next/link';
import { Suspense, useCallback, useEffect, useId, useState, type ReactNode } from 'react';
import { useI18n } from '@/lib/locale-client';
import type { ShellData } from '@/lib/shell-data';
import { Badge } from '../badge';
import { IconButton } from '../icon-button';
import { IconMenu } from '../icons';
import { TasnivoMark } from '../logo';
import { ToastProvider } from '../toast';
import { ClientSwitcher } from './client-switcher';
import { CommandPalette } from './command-palette';
import { MobileNav } from './mobile-nav';
import { NavigationProgress } from './navigation-progress';
import { NotificationBell } from './notification-bell';
import { PlanBanner } from './plan-banner';
import { Rail } from './rail';
import { ResponseNudge } from './response-nudge';
import { RouteBoundary } from './route-boundary';
import { RefreshAfterChange } from './router-cache';
import { NavigationWatchdog } from './same-route-links';
import { SearchButton } from './search-button';
import { isPaletteShortcut, isTypingTarget } from './shortcuts';
import { TopNav } from './top-nav';
import { UserMenu } from './user-menu';

type Props = { shell: ShellData; children: ReactNode };

/**
 * Signed-in frame: a header with the brand cell, section tabs and account controls; a slim icon rail
 * beside the page (from md); below md the same destinations open from the menu button. Plus the skip
 * link, plan banner, main area and command palette.
 */
export function AppFrame({ shell, children }: Props) {
  const { t, ta } = useI18n();
  const [menuOpen, setMenuOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const menuId = useId();

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
      <div className="relative flex h-dvh flex-col overflow-hidden bg-base print:block print:h-auto print:overflow-visible">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-toast focus:rounded-ctl focus:border focus:border-line-strong focus:bg-raised focus:px-3 focus:py-2 focus:text-data focus:font-medium focus:shadow-pop"
        >
          {ta.shellX.skip}
        </a>
        <MobileNav id={menuId} open={menuOpen} onClose={closeMenu} canWrite={shell.canWrite && !shell.demo} canTeam={shell.canManageTeam} />

        <header className="no-print flex h-14 shrink-0 items-stretch border-b border-line bg-base md:h-16">
          <span className="flex items-center pl-2 md:hidden">
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
          <Link href="/dashboard" aria-label={ta.shellX.nav.home} title={t.appName} className="grid w-12 shrink-0 place-items-center md:w-16 md:border-r md:border-line">
            <TasnivoMark className="size-7 text-fg" />
          </Link>
          <TopNav canWrite={shell.canWrite} canTeam={shell.canManageTeam} />
          {/* Shrinkable, so on a phone a long client name truncates instead of pushing the account menu off-screen. */}
          <div className="ml-auto flex min-w-0 items-center gap-1 px-2 sm:gap-2 sm:px-4">
            {/* It reads the query (useSearchParams); the boundary keeps any static render of the frame valid. */}
            <Suspense fallback={null}>
              <ClientSwitcher clients={shell.clients} active={shell.activeClient} canAdd={shell.canWrite && !shell.demo} />
            </Suspense>
            <SearchButton onOpen={() => setPaletteOpen(true)} expanded={paletteOpen} />
            {shell.demo ? <span className="hidden sm:inline-flex"><Badge tone="brand" title={ta.shell.demoTitle}>{ta.shell.demoPill}</Badge></span> : null}
            <NotificationBell initialUnread={shell.unread} />
            <UserMenu email={shell.email} />
          </div>
        </header>

        <div className="flex min-h-0 flex-1 print:block">
          <Rail canWrite={shell.canWrite} canTeam={shell.canManageTeam} canUpload={shell.canWrite && !shell.demo} unread={shell.unread} />
          <div className="relative flex min-w-0 flex-1 flex-col">
            <NavigationProgress />
            <PlanBanner plan={shell.plan} />
            <main id="main" tabIndex={-1} className="relative min-h-0 flex-1 overflow-y-auto outline-none print:overflow-visible"><RouteBoundary>{children}</RouteBoundary></main>
          </div>
        </div>
      </div>
      <Suspense fallback={null}>
        <NavigationWatchdog />
        <RefreshAfterChange />
      </Suspense>
      <ResponseNudge />
      <CommandPalette
        open={paletteOpen}
        onClose={closePalette}
        canWrite={shell.canWrite && !shell.demo}
        canTeam={shell.canManageTeam}
        clients={shell.clients}
        activeClientId={shell.activeClient?.id ?? null}
      />
    </ToastProvider>
  );
}
