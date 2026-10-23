'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { fmtNumber } from '@tasnivo/i18n/format';
import { useI18n } from '@/lib/locale-client';
import { cx } from '../cx';
import { IconCheck, IconChevronDown, IconSearch, IconUsers } from '../icons';
import { nextIndex } from '../keys';
import { Spinner } from '../spinner';
import { HoverTip } from './hover-tip';
import { nameInitials } from './initials';
import { allClientsTarget, switcherScope } from './nav';
import { matchesQuery } from './palette-model';
import { goTo } from './same-route-links';
import { useDropdown } from './use-dropdown';
import { useSwitchClient } from './use-switch-client';

type ClientRef = { id: string; name: string };
type Props = { clients: ClientRef[]; active: ClientRef | null; canAdd: boolean };
type Option = { key: string; label: string; detail?: string; mark: ReactNode; current: boolean; pick: () => void };

const ALL = 'all';

/** Square mark of a client (initials) or of "all clients" (an icon). */
function Mark({ children, strong }: { children: ReactNode; strong?: boolean }) {
  return (
    <span aria-hidden className={cx('grid size-6 shrink-0 place-items-center rounded-sm text-[0.6875rem] font-semibold leading-none', strong ? 'bg-brand-tint text-brand-ink' : 'bg-sunken text-muted')}>
      {children}
    </span>
  );
}

/**
 * Which client the page is about, and the way to another one: a combobox with a search field, "all
 * clients" first (the same page unfiltered, see allClientsTarget) and then the clients this user may see.
 * Focus stays in the field; arrows move, Enter picks, Escape returns to the trigger. Firm-wide pages and
 * unfiltered lists say "all clients"; a catalogue names its client in its own header, so the control is
 * neutral there.
 */
export function ClientSwitcher({ clients, active, canAdd }: Props) {
  const { locale, ta } = useI18n();
  const c = ta.shellX.client;
  const router = useRouter();
  const dd = useDropdown();
  const { switching, switchTo } = useSwitchClient();
  const [query, setQuery] = useState('');
  const [at, setAt] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const pathname = usePathname();
  const params = useSearchParams().toString();

  const scope = switcherScope(pathname, params);
  const scoped = scope.kind === 'client' ? clients.find((x) => x.id === scope.id) ?? null : null;
  const view = scope.kind === 'active' ? (active ? 'client' : 'none')
    : scope.kind === 'client' ? (scoped ? 'client' : scope.fallback)
    : scope.kind;
  const selected = scope.kind === 'active' ? active : scoped;
  const allHref = allClientsTarget(pathname, params);

  const name = view === 'client' && selected ? selected.name
    : view === 'all' ? c.all
    : view === 'record' ? c.listTitle
    : c.none;
  const quiet = view === 'record' || view === 'none';

  const options = useMemo<Option[]>(() => {
    const list: Option[] = [];
    if (allHref && clients.length > 1 && matchesQuery(c.all, [], query)) {
      list.push({
        key: ALL, label: c.all, detail: c.allHint, mark: <IconUsers size={14} />, current: view === 'all',
        pick: () => {
          dd.close(view === 'all');
          if (view !== 'all') goTo(allHref, (href) => router.push(href));
        },
      });
    }
    for (const x of clients) {
      if (!matchesQuery(x.name, [], query)) continue;
      const current = view === 'client' && x.id === selected?.id;
      list.push({
        key: x.id, label: x.name, mark: nameInitials(x.name), current,
        pick: () => {
          if (switching) return;
          if (current) { dd.close(true); return; }
          // On success the page changes (a document load), so the panel waits with its spinner.
          void switchTo(x.id);
        },
      });
    }
    return list;
  }, [allHref, clients, query, c, view, selected, dd, router, switching, switchTo]);

  const current = options.length === 0 ? -1 : Math.min(at, options.length - 1);
  const optionId = (i: number): string => `${listId}-${i}`;

  // Opening puts the current choice under the keyboard; typing starts from the first match.
  useEffect(() => {
    if (!dd.open) { setQuery(''); return; }
    setAt(Math.max(0, options.findIndex((o) => o.current)));
    input.current?.focus({ preventScroll: true });
    // Only on opening: later option changes come from typing.
  }, [dd.open]);
  useEffect(() => { if (dd.open) document.getElementById(optionId(current))?.scrollIntoView({ block: 'nearest' }); });

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    // Home and End stay with the text field (caret), as in any combobox.
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const next = nextIndex(e.key, current, options.length);
      if (next === null) return;
      e.preventDefault();
      setAt(next);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      options[current]?.pick();
    }
  };

  return (
    <div ref={dd.root} className="relative flex min-w-0 md:max-w-[16rem] 2xl:max-w-[22rem]" onBlur={dd.onBlur}>
      <HoverTip content={name} className="min-w-0">
        <button
          ref={dd.trigger}
          type="button"
          aria-haspopup="dialog"
          aria-expanded={dd.open}
          aria-controls={dd.open ? dd.panelId : undefined}
          aria-label={quiet ? name : c.trigger(name)}
          aria-busy={switching ? true : undefined}
          onClick={() => dd.setOpen(!dd.open)}
          className={cx(
            'flex h-control-md min-w-0 max-w-full items-center gap-2 rounded-ctl border border-line bg-raised pl-1.5 pr-2 text-data font-medium text-fg',
            'transition-colors duration-(--duration-fast) hover:border-line-strong hover:bg-surface',
            dd.open && 'border-line-strong bg-surface',
          )}
        >
          {view === 'client' && selected ? <Mark strong>{nameInitials(selected.name)}</Mark> : <Mark><IconUsers size={14} /></Mark>}
          <span className={cx('min-w-0 truncate', quiet && 'text-muted')}>{name}</span>
          {switching ? <Spinner size={14} /> : <IconChevronDown size={14} className={cx('shrink-0 text-muted transition-transform duration-(--duration-fast)', dd.open && 'rotate-180')} />}
        </button>
      </HoverTip>
      {dd.open ? (
        <div
          ref={dd.panel}
          id={dd.panelId}
          role="dialog"
          aria-label={c.listTitle}
          tabIndex={-1}
          className={cx(
            'z-dropdown flex max-h-[min(28rem,calc(100dvh-5rem))] flex-col overflow-hidden rounded-md border border-line bg-raised text-fg shadow-pop focus-visible:outline-none motion-safe:animate-pop-in',
            'max-sm:fixed max-sm:inset-x-2 max-sm:top-14 sm:absolute sm:right-0 sm:top-full sm:mt-1 sm:w-80',
          )}
        >
          {clients.length === 0 ? (
            <p className="px-3 py-4 text-small text-muted">{c.noneHint}</p>
          ) : (
            <>
              <div className="relative flex items-center border-b border-line">
                <span aria-hidden className="pointer-events-none absolute left-3 text-muted"><IconSearch size={16} /></span>
                <input
                  ref={input}
                  type="text"
                  role="combobox"
                  aria-expanded
                  aria-controls={listId}
                  aria-activedescendant={current >= 0 ? optionId(current) : undefined}
                  aria-autocomplete="list"
                  aria-label={c.search}
                  aria-describedby={`${listId}-hint`}
                  placeholder={c.search}
                  value={query}
                  onChange={(e) => { setQuery(e.target.value); setAt(0); }}
                  onKeyDown={onKeyDown}
                  autoComplete="off"
                  spellCheck={false}
                  className="h-11 w-full bg-transparent pl-9 pr-3 text-data text-fg outline-none placeholder:text-subtle"
                />
              </div>
              <p id={`${listId}-hint`} className="sr-only">{c.hint}</p>
              <div id={listId} role="listbox" aria-label={c.listTitle} className="relative min-h-0 flex-1 overflow-y-auto p-1">
                {options.map((o, i) => {
                  const busy = switching === o.key;
                  return (
                    <div
                      key={o.key}
                      id={optionId(i)}
                      role="option"
                      aria-selected={i === current}
                      aria-disabled={switching && !busy ? true : undefined}
                      onPointerMove={() => { if (i !== current) setAt(i); }}
                      onClick={o.pick}
                      className={cx(
                        'flex cursor-pointer items-center gap-2.5 rounded-sm px-2 py-1.5 text-data',
                        i === current ? 'bg-surface' : '',
                        o.key === ALL && clients.length > 1 && 'mb-1',
                        switching && !busy && 'cursor-progress opacity-60',
                      )}
                    >
                      <Mark strong={o.current}>{o.mark}</Mark>
                      <span className="min-w-0 flex-1">
                        <span className={cx('block truncate', o.current ? 'font-semibold text-brand-ink' : 'text-fg')} title={o.label}>{o.label}</span>
                        {o.detail ? <span className="block truncate text-micro text-muted">{o.detail}</span> : null}
                      </span>
                      {busy ? <Spinner size={14} label={c.switching} /> : null}
                      {o.current && !busy ? (
                        <span className="relative shrink-0 text-brand-ink">
                          <IconCheck size={16} />
                          <span className="sr-only">{c.current}</span>
                        </span>
                      ) : null}
                    </div>
                  );
                })}
                {options.length === 0 ? <p className="px-2.5 py-3 text-small text-muted">{c.noMatch}</p> : null}
              </div>
            </>
          )}
          <div className="flex items-center justify-between gap-2 border-t border-line px-1 py-1">
            <Link href="/clients" onClick={() => dd.close(false)} className="rounded-sm px-2.5 py-1.5 text-small font-medium text-muted hover:bg-surface hover:text-fg focus-visible:outline-offset-[-2px]">
              {c.manage} <span className="tabular-nums text-subtle">{fmtNumber(locale, clients.length)}</span>
            </Link>
            {canAdd ? (
              <Link href="/clients?new=1" onClick={() => dd.close(false)} className="rounded-sm px-2.5 py-1.5 text-small font-medium text-brand-ink hover:bg-surface focus-visible:outline-offset-[-2px]">
                {c.add}
              </Link>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
