'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useI18n } from '@/lib/locale-client';
import { cx } from '../cx';
import { IconCheck, IconChevronDown } from '../icons';
import { Input } from '../input';
import { nextIndex } from '../keys';
import { Spinner } from '../spinner';
import { HoverTip } from './hover-tip';
import { switcherScope } from './nav';
import { matchesQuery } from './palette-model';
import { useDropdown } from './use-dropdown';
import { useSwitchClient } from './use-switch-client';

type ClientRef = { id: string; name: string };
type Props = { clients: ClientRef[]; active: ClientRef | null; canAdd: boolean };

/** More clients than this get a search field. */
const SEARCH_FROM = 9;

/**
 * Which client the page is about, and the way to another one. Firm-wide pages and unfiltered
 * lists say "all clients"; a catalogue names its client in its own header, so the control stays
 * neutral there. Lists only the clients this user may see.
 */
export function ClientSwitcher({ clients, active, canAdd }: Props) {
  const { ta } = useI18n();
  const dd = useDropdown();
  const { switching, switchTo } = useSwitchClient();
  const [query, setQuery] = useState('');
  const search = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const listId = useId();
  const withSearch = clients.length >= SEARCH_FROM;
  const pathname = usePathname();
  const params = useSearchParams().toString();

  const shown = useMemo(() => clients.filter((c) => matchesQuery(c.name, [], query)), [clients, query]);
  const scope = switcherScope(pathname, params);
  const scoped = scope.kind === 'client' ? clients.find((c) => c.id === scope.id) ?? null : null;
  const view = scope.kind === 'active' ? (active ? 'client' : 'none')
    : scope.kind === 'client' ? (scoped ? 'client' : scope.fallback)
    : scope.kind;
  const selected = scope.kind === 'active' ? active : scoped;

  useEffect(() => {
    if (!dd.open) { setQuery(''); return; }
    const target = search.current
      ?? list.current?.querySelector<HTMLButtonElement>('button[aria-current="true"]')
      ?? list.current?.querySelector<HTMLButtonElement>('button')
      ?? dd.panel.current;
    target?.focus({ preventScroll: true });
  }, [dd.open, dd.panel]);

  const pick = async (id: string): Promise<void> => {
    if (switching) return;
    if (view === 'client' && id === selected?.id) { dd.close(true); return; }
    // On success the page changes (a document load), so the panel just waits with its spinner.
    await switchTo(id);
  };

  const options = (): HTMLButtonElement[] => Array.from(list.current?.querySelectorAll<HTMLButtonElement>('button') ?? []);
  const onListKey = (e: KeyboardEvent<HTMLUListElement>): void => {
    const items = options();
    const at = items.findIndex((el) => el === document.activeElement);
    if (e.key === 'ArrowUp' && at === 0 && search.current) { e.preventDefault(); search.current.focus(); return; }
    const next = nextIndex(e.key, at, items.length);
    if (next === null) return;
    e.preventDefault();
    items[next]?.focus();
  };
  const onSearchKey = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key !== 'ArrowDown') return;
    e.preventDefault();
    options()[0]?.focus();
  };

  const name = view === 'client' && selected ? selected.name
    : view === 'all' ? ta.shellX.client.all
    : view === 'record' ? ta.shellX.client.listTitle
    : ta.shellX.client.none;
  const quiet = view === 'record' || view === 'none';
  return (
    <div ref={dd.root} className="relative flex min-w-0 md:max-w-[22rem] lg:max-w-[28rem]" onBlur={dd.onBlur}>
      <HoverTip content={name} className="min-w-0">
        <button
          ref={dd.trigger}
          type="button"
          aria-haspopup="dialog"
          aria-expanded={dd.open}
          aria-controls={dd.open ? dd.panelId : undefined}
          aria-label={quiet ? name : ta.shellX.client.trigger(name)}
          aria-busy={switching ? true : undefined}
          onClick={() => dd.setOpen(!dd.open)}
          className="flex h-control-md min-w-0 max-w-full items-center gap-2 rounded-ctl border border-transparent px-2.5 text-data font-medium text-fg transition-colors duration-(--duration-fast) hover:border-line hover:bg-surface"
        >
          {quiet ? null : <span className="hidden shrink-0 text-muted sm:inline">{ta.shellX.client.label}</span>}
          <span className={cx('min-w-0 truncate', quiet && 'text-muted')}>{name}</span>
          {switching ? <Spinner size={14} /> : <IconChevronDown size={14} className={cx('shrink-0 text-muted transition-transform duration-(--duration-fast)', dd.open && 'rotate-180')} />}
        </button>
      </HoverTip>
      {dd.open ? (
        <div
          ref={dd.panel}
          id={dd.panelId}
          role="dialog"
          aria-label={ta.shellX.client.listTitle}
          aria-describedby={clients.length > 0 ? `${dd.panelId}-hint` : undefined}
          tabIndex={-1}
          className="absolute left-0 top-full z-dropdown mt-1 w-[min(20rem,calc(100vw-4rem))] rounded-md border border-line bg-raised p-1 text-fg shadow-pop focus-visible:outline-none motion-safe:animate-pop-in"
        >
          {clients.length > 0 ? <p id={`${dd.panelId}-hint`} className="px-2.5 pb-1.5 pt-1 text-micro text-muted">{ta.shellX.client.hint}</p> : null}
          {withSearch ? (
            <div className="p-1">
              <Input
                ref={search} type="search" size="compact" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={onSearchKey}
                placeholder={ta.shellX.client.search} aria-label={ta.shellX.client.search} aria-controls={listId} autoComplete="off"
              />
            </div>
          ) : null}
          {clients.length === 0 ? (
            <p className="px-2.5 py-2 text-small text-muted">{ta.shellX.client.noneHint}</p>
          ) : (
            <ul id={listId} ref={list} aria-label={ta.shellX.client.listTitle} onKeyDown={onListKey} className="relative max-h-72 overflow-y-auto">
              {shown.map((c) => {
                const isCurrent = view === 'client' && c.id === selected?.id;
                const busy = switching === c.id;
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      aria-current={isCurrent ? 'true' : undefined}
                      aria-disabled={switching ? true : undefined}
                      onClick={() => { void pick(c.id); }}
                      className={cx(
                        'flex w-full items-start gap-2 rounded-sm px-2.5 py-1.5 text-left text-data hover:bg-surface focus:bg-surface focus-visible:outline-offset-[-2px]',
                        isCurrent ? 'font-semibold text-brand-ink' : 'text-fg',
                        switching && !busy && 'cursor-progress opacity-60',
                      )}
                    >
                      <span className="min-w-0 flex-1 break-words">{c.name}</span>
                      {busy ? <Spinner size={14} label={ta.shellX.client.switching} className="mt-0.5" /> : null}
                      {isCurrent && !busy ? (
                        <span className="relative mt-0.5 shrink-0">
                          <IconCheck size={16} />
                          <span className="sr-only">{ta.shellX.client.current}</span>
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
              {shown.length === 0 ? <li className="px-2.5 py-2 text-small text-muted">{ta.shellX.client.noMatch}</li> : null}
            </ul>
          )}
          {canAdd ? (
            <div className="mt-1 border-t border-line pt-1">
              <Link href="/clients" onClick={() => dd.close(false)} className="flex w-full items-center rounded-sm px-2.5 py-1.5 text-data font-medium text-brand-ink hover:bg-surface focus-visible:outline-offset-[-2px]">
                {ta.shellX.client.add}
              </Link>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
