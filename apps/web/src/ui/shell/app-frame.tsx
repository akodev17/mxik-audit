'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Suspense, useCallback, useEffect, useId, useState, type ReactNode } from 'react';
import { api } from '@/lib/api/browser';
import { useI18n } from '@/lib/locale-client';
import type { ShellData } from './shell-queries';
import { Badge } from '../badge';
import { IconButton } from '../icon-button';
import { IconMenu } from '../icons';
import { TasnivoMark } from '../logo';
import { ToastProvider } from '../toast';
import { TourProvider } from '../tour/tour-context';
import { TourAutoStart } from '../tour/tour-auto-start';
import { TourOverlay } from '../tour/tour-overlay';
import { useTourFlag } from '../tour/use-tour-flag';
import { ClientSwitcher } from './client-switcher';
import { CommandPalette } from './command-palette';
import { MobileNav } from './mobile-nav';
import { NavigationProgress } from './navigation-progress';
import { NotificationBell } from './notification-bell';
import { rememberRecent } from './palette-recent';
import { PlanBanner } from './plan-banner';
import { sidebarCookie, toggledSidebar, type SidebarPref } from './prefs';
import { Rail } from './rail';
import { ResponseNudge } from './response-nudge';
import { RouteBoundary } from './route-boundary';
import { RefreshAfterChange } from './router-cache';
import { NavigationWatchdog } from './same-route-links';
import { SearchButton } from './search-button';
import { isPaletteShortcut, isTypingTarget } from './shortcuts';
import { TopNav } from './top-nav';
import { useMediaQuery } from './use-media-query';
import { UserMenu } from './user-menu';

type Props = { shell: ShellData; sidebar: SidebarPref; children: ReactNode };

/**
 * Signed-in frame. From md: a sidebar the full height of the window (brand, upload, notifications,
 * clients, help, settings), and beside it the header (section tabs, client, search, bell, account) over
 * the page. Below md the sidebar is hidden and every destination opens from the menu button. The
 * header comes first in the document, so keyboard and screen-reader order is header, sidebar, page.
 */
export function AppFrame({ shell, sidebar, children }: Props) {
  const { ta } = useI18n();
  const [menuOpen, setMenuOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [pref, setPref] = useState<SidebarPref>(sidebar);
  const menuId = useId();
  const lg = useMediaQuery('(min-width: 1024px)', false);
  const xl = useMediaQuery('(min-width: 1280px)', false);
  const labelled = pref === 'collapsed' ? false : pref === 'expanded' ? lg : xl;

  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const closePalette = useCallback(() => setPaletteOpen(false), []);
  const toggleRail = useCallback(() => {
    const next = toggledSidebar(labelled);
    setPref(next);
    // The cookie only decides the next server render; the frame has already changed. Written here at
    // once so a reload right away keeps the choice (B6); the PUT stays for the account's record.
    document.cookie = sidebarCookie(next);
    void api.account.setSidebar({ state: next }).catch(() => undefined);
  }, [labelled]);

  // A newer cookie from another tab arrives with the next server render.
  useEffect(() => setPref(sidebar), [sidebar]);

  // A client's page opened from anywhere becomes a recent item of the palette.
  const pathname = usePathname();
  useEffect(() => {
    const id = /^\/clients\/([^/]+)$/.exec(pathname)?.[1];
    const client = id ? shell.clients.find((c) => encodeURIComponent(c.id) === id) : undefined;
    if (client) rememberRecent({ kind: 'client', id: client.id, label: client.name, href: `/clients/${id}` });
  }, [pathname, shell.clients]);

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

  const tour = useTourFlag(shell.tour);
  const canUpload = shell.canWrite && !shell.demo;
  return (
    <ToastProvider>
      <TourProvider canWrite={canUpload} canManageTeam={shell.canManageTeam} onDone={tour.onDone}>
        <div
          data-rail={pref}
          className="group/frame relative grid h-dvh grid-cols-[auto_minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-base print:block print:h-auto print:overflow-visible"
        >
          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-toast focus:rounded-ctl focus:border focus:border-line-strong focus:bg-raised focus:px-3 focus:py-2 focus:text-data focus:font-medium focus:shadow-pop"
          >
            {ta.shellX.skip}
          </a>
          <MobileNav
            id={menuId} open={menuOpen} onClose={closeMenu} canWrite={canUpload} canTeam={shell.canManageTeam}
            email={shell.email} unread={shell.unread}
          />

          <header className="no-print col-start-2 row-start-1 flex h-14 min-w-0 items-stretch border-b border-line bg-base">
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
            <Link href="/dashboard" aria-label={ta.shellX.nav.home} className="grid w-11 shrink-0 place-items-center md:hidden">
              <TasnivoMark className="size-7 text-fg" />
            </Link>
            <TopNav canWrite={shell.canWrite} canTeam={shell.canManageTeam} />
            {/* Shrinkable, so on a phone a long client name truncates instead of pushing the account menu off-screen. */}
            <div className="ml-auto flex min-w-0 items-center gap-1 px-2 sm:gap-1.5 sm:px-4">
              {/* It reads the query (useSearchParams); the boundary keeps any static render of the frame valid. */}
              <Suspense fallback={null}>
                <ClientSwitcher clients={shell.clients} active={shell.activeClient} canAdd={canUpload} />
              </Suspense>
              <span aria-hidden className="mx-1 hidden h-6 w-px shrink-0 bg-line sm:block" />
              <SearchButton onOpen={() => setPaletteOpen(true)} expanded={paletteOpen} />
              {shell.demo ? <span className="hidden sm:inline-flex"><Badge tone="brand" title={ta.shell.demoTitle}>{ta.shell.demoPill}</Badge></span> : null}
              <NotificationBell initialUnread={shell.unread} />
              <UserMenu email={shell.email} canTour={!shell.demo} />
            </div>
          </header>

          <Rail
            canWrite={shell.canWrite} canTeam={shell.canManageTeam} canUpload={canUpload} unread={shell.unread}
            clients={shell.clients} activeClientId={shell.activeClient?.id ?? null} labelled={labelled} onToggle={toggleRail}
          />

          <div className="relative col-start-2 row-start-2 flex min-h-0 min-w-0 flex-col print:block">
            <NavigationProgress />
            <PlanBanner plan={shell.plan} />
            <main id="main" tabIndex={-1} className="relative min-h-0 flex-1 overflow-y-auto outline-none print:overflow-visible"><RouteBoundary>{children}</RouteBoundary></main>
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
          canWrite={canUpload}
          canTeam={shell.canManageTeam}
          clients={shell.clients}
          activeClientId={shell.activeClient?.id ?? null}
        />
        <TourOverlay />
        <TourAutoStart pending={tour.pending && !shell.demo} />
      </TourProvider>
    </ToastProvider>
  );
}
