'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useId, useRef, useState, type FocusEvent, type PointerEvent, type ReactNode } from 'react';
import { useI18n } from '@/lib/locale-client';
import { fmtNumber } from '@tasnivo/i18n/format';
import { cx } from '../cx';
import { IconBell, IconUpload } from '../icons';
import { TasnivoMark } from '../logo';
import { useEscape } from '../overlay';
import { IconPanel } from './icons';
import { nameInitials } from './initials';
import { useIntentPrefetch } from './intent-prefetch';
import { isActive } from './nav';
import { useNav } from './nav-items';
import { RAIL } from './prefs';

type ClientRef = { id: string; name: string };

/** Clients listed in the sidebar; the rest are one click away on the clients page. */
const RAIL_CLIENTS = 5;
const HOVER_DELAY_MS = 300;

const ITEM = cx(
  'relative flex h-9 w-full min-w-0 items-center gap-3 rounded-ctl px-2.5 text-data font-medium transition-colors duration-(--duration-fast)',
  RAIL.item,
);
const IDLE = 'text-muted hover:bg-sunken hover:text-fg';
const CURRENT = 'bg-raised text-fg shadow-sm ring-1 ring-line';

function focusVisible(target: EventTarget): boolean {
  try {
    return target instanceof Element && target.matches(':focus-visible');
  } catch {
    return true;
  }
}

/**
 * A sidebar row. With names on screen it needs no tooltip; as an icon it shows its name beside it on hover
 * and keyboard focus (to the right, so the next icon stays clickable). The name is the accessible name either way.
 */
function RailItem({ label, visible, className, render }: {
  label: string;
  /** The on-screen name when it differs from the label (the toggle only ever says "collapse" there). */
  visible?: string;
  className?: string;
  render: (props: { onFocus: (e: FocusEvent) => void; onBlur: () => void; text: ReactNode }) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const name = useRef<HTMLElement | null>(null);
  const tipId = useId();
  const named = (): boolean => Boolean(name.current && name.current.offsetWidth > 0);
  const clear = (): void => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  const hide = (): void => {
    clear();
    setOpen(false);
  };
  const onPointerEnter = (e: PointerEvent): void => {
    if (e.pointerType === 'touch' || named()) return;
    clear();
    // Checked again when the delay ends: the sidebar may have been expanded meanwhile.
    timer.current = setTimeout(() => { if (!named()) setOpen(true); }, HOVER_DELAY_MS);
  };
  useEffect(() => clear, []);
  useEscape(open, hide);

  const text = <span ref={(el) => { name.current = el; }} className={cx('min-w-0 flex-1 truncate text-left', RAIL.text)}>{visible ?? label}</span>;
  return (
    <span className={cx('relative flex', className)} onPointerEnter={onPointerEnter} onPointerLeave={hide}>
      {render({
        onFocus: (e) => { if (focusVisible(e.target) && !named()) setOpen(true); },
        onBlur: hide,
        text,
      })}
      <span role="tooltip" id={tipId} hidden={!open} className="absolute left-full top-1/2 z-dropdown w-max max-w-64 -translate-y-1/2 pl-2">
        <span className="block rounded-sm bg-fg px-2 py-1 text-micro font-medium text-inverse shadow-pop motion-safe:animate-fade-in">{label}</span>
      </span>
    </span>
  );
}

function RailLink({ href, label, icon, active, trailing, className, tour }: {
  href: string; label: string; icon: ReactNode; active: boolean; trailing?: ReactNode; className?: string;
  /** Step target of the guided tour (data-tour). */
  tour?: string;
}) {
  const intent = useIntentPrefetch()(href);
  return (
    <RailItem
      label={label}
      render={({ onFocus, onBlur, text }) => (
        <Link
          href={href}
          aria-label={label}
          aria-current={active ? 'page' : undefined}
          data-tour={tour}
          onPointerEnter={intent.onPointerEnter}
          onPointerLeave={intent.onPointerLeave}
          onPointerDown={intent.onPointerDown}
          onFocus={(e) => { intent.onFocus(e); onFocus(e); }}
          onBlur={onBlur}
          className={cx(ITEM, active ? CURRENT : IDLE, className)}
        >
          <span aria-hidden className={cx('relative grid shrink-0 place-items-center', active && 'text-brand-ink')}>{icon}</span>
          {text}
          {trailing}
        </Link>
      )}
    />
  );
}

/**
 * The left sidebar from md, the full height of the window beside the header and the page. It holds what
 * the header tabs do not: upload, notifications, the firm's clients, help and settings. From xl (or lg
 * when the user expanded it) every item shows its name; otherwise it is a column of icons with tooltips.
 * The toggle at the bottom remembers the choice in a cookie, so the next page renders the same way.
 */
export function Rail({ canWrite, canTeam, canUpload, unread, clients = [], activeClientId = null, labelled = false, onToggle, activePath }: {
  canWrite: boolean; canTeam: boolean; canUpload: boolean; unread: number | null;
  clients?: ClientRef[]; activeClientId?: string | null;
  /** Names on screen now (from the media queries; false until the browser has measured). */
  labelled?: boolean;
  onToggle?: () => void;
  activePath?: string;
}) {
  const { locale, t, ta } = useI18n();
  const current = usePathname();
  const pathname = activePath ?? current;
  const items = useNav(canWrite, canTeam).flatMap((g) => g.items);
  const help = items.find((i) => i.key === 'help');
  const settings = items.find((i) => i.key === 'settings');
  // Not in a demo: uploading is switched off there, and a shortcut to a dead end is worse than none.
  const upload = canUpload ? items.find((i) => i.key === 'upload' && !i.soon) : undefined;
  const headingId = useId();
  const count = unread ?? 0;

  const active = clients.find((c) => c.id === activeClientId);
  const listed = [...(active ? [active] : []), ...clients.filter((c) => c.id !== activeClientId)].slice(0, RAIL_CLIENTS);
  const toggleLabel = labelled ? ta.shellX.nav.collapse : ta.shellX.nav.expand;

  return (
    <div className={cx('no-print col-start-1 row-span-2 row-start-1 hidden min-h-0 shrink-0 flex-col border-r border-line bg-surface transition-[width] duration-(--duration-base) ease-standard motion-reduce:transition-none md:flex print:hidden', RAIL.width)}>
      <Link href="/dashboard" aria-label={ta.shellX.nav.home} title={t.appName} className={cx('flex h-14 shrink-0 items-center gap-2.5 border-b border-line px-[1.125rem]', RAIL.item)}>
        <TasnivoMark className="size-7 text-fg" />
        <span className={cx('truncate text-section font-semibold tracking-tight', RAIL.text)}>{t.appName}</span>
      </Link>
      <nav aria-label={ta.shellX.nav.utilities} className="flex min-h-0 flex-1 flex-col">
        <div className="flex flex-col gap-1 px-3 pt-3">
          {upload ? (
            <RailLink
              href={upload.href} label={ta.shellX.nav.upload} tour="rail-upload" icon={<IconUpload size={18} />} active={isActive(pathname, upload.href)}
              className="mb-2 border border-line-strong bg-raised text-fg shadow-sm hover:border-line-input hover:bg-raised"
            />
          ) : null}
          <RailLink
            href="/notifications" label={ta.shellX.bell.title} active={isActive(pathname, '/notifications')}
            icon={(
              <>
                <IconBell size={18} />
                {count > 0 ? <span aria-hidden className={cx('absolute -right-1 -top-1 size-2 rounded-full bg-brand ring-2 ring-surface', RAIL.iconsOnly)} /> : null}
              </>
            )}
            trailing={count > 0 ? (
              <>
                <span aria-hidden className={cx('h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-brand px-1.5 text-micro font-semibold tabular-nums text-on-fill', RAIL.shown)}>
                  {count > 99 ? '99+' : fmtNumber(locale, count)}
                </span>
                <span className="sr-only">{ta.shellX.bell.newCount(fmtNumber(locale, count))}</span>
              </>
            ) : null}
          />
        </div>

        {listed.length > 0 ? (
          <div className={cx('min-h-0 flex-1 flex-col overflow-y-auto px-3 pt-5', RAIL.shown)}>
            <p id={headingId} className="px-2.5 pb-1.5 text-micro font-medium text-subtle">{ta.shellX.nav.railClients}</p>
            <ul aria-labelledby={headingId} className="flex flex-col gap-0.5">
              {listed.map((c) => {
                const here = isActive(pathname, `/clients/${c.id}`);
                return (
                  <li key={c.id}>
                    <Link
                      href={`/clients/${c.id}`}
                      aria-current={here ? 'page' : undefined}
                      title={c.name}
                      className={cx('flex h-8 min-w-0 items-center gap-2.5 rounded-ctl px-2.5 text-data transition-colors duration-(--duration-fast)', here ? CURRENT : 'text-muted hover:bg-sunken hover:text-fg')}
                    >
                      <span aria-hidden className={cx('grid size-5 shrink-0 place-items-center rounded-sm text-[0.625rem] font-semibold leading-none', c.id === activeClientId ? 'bg-brand-tint text-brand-ink' : 'bg-sunken text-muted')}>
                        {nameInitials(c.name)}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{c.name}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
            {clients.length > listed.length ? (
              <Link href="/clients" className="mt-1 flex h-8 items-center rounded-ctl px-2.5 text-small font-medium text-brand-ink hover:bg-sunken">
                {ta.shellX.nav.allClients(fmtNumber(locale, clients.length))}
              </Link>
            ) : null}
          </div>
        ) : null}

        <div className="mt-auto flex flex-col gap-1 border-t border-line px-3 py-3">
          {help ? <RailLink href={help.href} tour="rail-help" label={help.label} icon={help.icon} active={isActive(pathname, help.href)} /> : null}
          {settings ? <RailLink href={settings.href} tour="rail-settings" label={settings.label} icon={settings.icon} active={isActive(pathname, settings.href)} /> : null}
          {onToggle ? <RailItem
            label={toggleLabel}
            visible={ta.shellX.nav.collapse}
            className="hidden lg:flex"
            render={({ onFocus, onBlur, text }) => (
              <button
                type="button"
                onClick={onToggle}
                onFocus={onFocus}
                onBlur={onBlur}
                aria-label={toggleLabel}
                aria-expanded={labelled}
                className={cx(ITEM, IDLE)}
              >
                <span aria-hidden className="grid shrink-0 place-items-center"><IconPanel size={18} /></span>
                {text}
              </button>
            )}
          /> : null}
        </div>
      </nav>
    </div>
  );
}
