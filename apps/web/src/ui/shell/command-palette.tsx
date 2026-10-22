'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { searchEverything } from '@/app/actions/shell';
import { fmtDate } from '@tasnivo/i18n/format';
import { useI18n } from '@/lib/locale-client';
import { MIN_TEXT } from '@tasnivo/domain/search-query';
import type { ProductStatus, SearchResults } from '@tasnivo/domain/search';
import { Badge, type Tone } from '../badge';
import { Button } from '../button';
import { cx } from '../cx';
import { Dialog } from '../dialog';
import { IconBell, IconCheck, IconSearch, IconTable, IconUsers } from '../icons';
import { IconButton } from '../icon-button';
import { Input } from '../input';
import { Kbd } from '../kbd';
import { nextIndex } from '../keys';
import { Spinner } from '../spinner';
import { useToast } from '../toast';
import { IconArrowLeft, IconBox, IconHash, IconSwitch } from './icons';
import { NAV_ICONS, useNavLabels } from './nav-items';
import { matchesQuery, paletteCommands, type CommandKey } from './palette-model';
import { goTo } from './same-route-links';
import { useSwitchClient } from './use-switch-client';

type ClientRef = { id: string; name: string };
type Props = { open: boolean; onClose: () => void; canWrite: boolean; canTeam: boolean; clients: ClientRef[]; activeClientId: string | null };

type Action = { kind: 'go'; href: string } | { kind: 'copy'; text: string } | { kind: 'mode' } | { kind: 'switch'; clientId: string };
type GroupKey = 'commands' | 'clients' | 'catalogs' | 'products' | 'codes' | 'switch';
type Option = { key: string; label: ReactNode; detail?: ReactNode; meta?: ReactNode; icon: ReactNode; action: Action; mono?: boolean };
type Group = { key: GroupKey; label: string; hint?: string; options: Option[] };
type Answer = { text: string; results: SearchResults };
type Status = { kind: 'idle' } | { kind: 'loading'; previous: Answer | null } | { kind: 'failed' } | { kind: 'done'; answer: Answer };

/** Results stay on screen while the query only narrows them; a new kind of query (a code) clears them. */
function keepWhileLoading(last: Answer | null, text: string): Answer | null {
  if (!last || /^\d+$/.test(text)) return null;
  return text.toLocaleLowerCase().startsWith(last.text.toLocaleLowerCase()) ? last : null;
}

const DEBOUNCE_MS = 250;
const STATUS_TONE: Record<ProductStatus, Tone> = { attention: 'warn', decided: 'good', auto: 'brand', info: 'info', clean: 'neutral' };

/**
 * Ctrl+K palette: page commands, client switching, and search over clients, catalogues, products and
 * classifier codes. Combobox and listbox semantics: focus stays in the field, arrows move, Enter acts.
 */
export function CommandPalette({ open, onClose, canWrite, canTeam, clients, activeClientId }: Props) {
  const { t, ta, locale } = useI18n();
  const s = ta.shellX.search;
  const router = useRouter();
  const toast = useToast();
  const navLabels = useNavLabels();
  const { switching, switchTo } = useSwitchClient();
  const [mode, setMode] = useState<'root' | 'switch'>('root');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [active, setActive] = useState(0);
  const [retry, setRetry] = useState(0);
  const seq = useRef(0);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const optionId = (i: number): string => `${listId}-option-${i}`;

  useEffect(() => {
    if (open) return;
    seq.current += 1;
    setMode('root');
    setQuery('');
    setStatus({ kind: 'idle' });
    setActive(0);
  }, [open]);

  const text = query.trim();
  const searching = open && mode === 'root' && text.length >= MIN_TEXT;

  // Debounced; a response for an older query (or after closing) is dropped.
  useEffect(() => {
    if (!searching) {
      seq.current += 1;
      setStatus({ kind: 'idle' });
      return;
    }
    const mine = ++seq.current;
    setStatus((prev) => ({ kind: 'loading', previous: keepWhileLoading(prev.kind === 'done' ? prev.answer : prev.kind === 'loading' ? prev.previous : null, text) }));
    const timer = setTimeout(() => {
      searchEverything(text)
        .then((r) => { if (mine === seq.current) setStatus(r.ok ? { kind: 'done', answer: { text, results: r.results } } : { kind: 'failed' }); })
        .catch(() => { if (mine === seq.current) setStatus({ kind: 'failed' }); });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searching, text, retry]);

  const commands = useMemo<Option[]>(() => {
    // The page's own name matches too, so "Kataloglar" finds "Kataloglarni ochish".
    const keyword = (key: CommandKey): string =>
      (key === 'notifications' ? ta.shellX.bell.title : key === 'switchClient' ? ta.shellX.client.label : navLabels[key]);
    const icon = (key: CommandKey): ReactNode => (key === 'notifications' ? <IconBell /> : key === 'switchClient' ? <IconSwitch /> : NAV_ICONS[key]);
    return paletteCommands({ canWrite, canTeam, locale, clientCount: clients.length })
      .filter((c) => matchesQuery(s.cmd[c.key], [keyword(c.key)], query))
      .map((c): Option => ({
        key: `cmd-${c.key}`,
        label: s.cmd[c.key],
        icon: icon(c.key),
        action: c.href ? { kind: 'go', href: c.href } : { kind: 'mode' },
      }));
  }, [canWrite, canTeam, locale, clients.length, s, ta, navLabels, query]);

  const results = status.kind === 'done' ? status.answer.results : status.kind === 'loading' ? status.previous?.results ?? null : null;

  const groups = useMemo<Group[]>(() => {
    if (mode === 'switch') {
      const options = clients.filter((c) => matchesQuery(c.name, [], query)).map((c): Option => ({
        key: `switch-${c.id}`,
        label: c.name,
        icon: <IconUsers />,
        meta: c.id === activeClientId ? <span className="relative inline-flex text-brand-ink"><IconCheck size={16} /><span className="sr-only">{ta.shellX.client.current}</span></span> : undefined,
        action: { kind: 'switch', clientId: c.id },
      }));
      return [{ key: 'switch', label: s.groups.switch, options }];
    }
    const list: Group[] = [{ key: 'commands', label: s.groups.commands, options: commands }];
    if (!results || !searching) return list;
    list.push({
      key: 'clients', label: s.groups.clients,
      options: results.clients.map((c) => ({ key: `client-${c.id}`, label: c.name, icon: <IconUsers />, action: { kind: 'go', href: c.href } })),
    });
    list.push({
      key: 'catalogs', label: s.groups.catalogs,
      options: results.catalogs.map((c) => ({
        key: `catalog-${c.id}`, label: c.filename, icon: <IconTable />,
        detail: [c.clientName, fmtDate(locale, c.createdAt)].filter(Boolean).join(' · '),
        meta: c.status === 'ready' ? undefined : <Badge tone={c.status === 'failed' ? 'danger' : 'info'}>{t.catalogStatus[c.status]}</Badge>,
        action: { kind: 'go', href: c.href },
      })),
    });
    list.push({
      key: 'products', label: s.groups.products, hint: s.groups.productsHint,
      // A clean row is not in the workspace grid: its outcome is said here, and Enter opens the catalogue.
      options: results.products.map((p) => ({
        key: `product-${p.id}`, label: p.name, icon: <IconBox />,
        detail: <>{[p.clientName, p.status === 'clean' ? s.cleanRow(String(p.row)) : s.row(String(p.row))].filter(Boolean).join(' · ')}{p.code ? <> · <span className="font-mono">{p.code}</span></> : null}</>,
        meta: p.status === 'clean' ? undefined : <Badge tone={STATUS_TONE[p.status]}>{s.status[p.status]}</Badge>,
        action: { kind: 'go', href: p.href },
      })),
    });
    list.push({
      key: 'codes', label: s.groups.codes,
      options: results.codes.map((c) => ({
        key: `code-${c.code}`, label: c.code, icon: <IconHash />, mono: true,
        detail: c.name,
        meta: c.retired ? <Badge tone="warn">{s.retired}</Badge> : undefined,
        action: { kind: 'copy', text: c.code },
      })),
    });
    return list;
  }, [mode, clients, query, activeClientId, s, ta, t, commands, results, searching, locale]);

  const visible = groups.filter((g) => g.options.length > 0);
  const flat = visible.flatMap((g) => g.options);
  const current = flat.length === 0 ? -1 : Math.min(active, flat.length - 1);
  const flatKey = flat.map((o) => o.key).join('|');

  useEffect(() => setActive(0), [flatKey]);
  const activeId = current >= 0 ? optionId(current) : null;
  useEffect(() => {
    if (open && activeId) document.getElementById(activeId)?.scrollIntoView({ block: 'nearest' });
  }, [open, activeId]);

  const backToCommands = (): void => {
    setMode('root');
    setQuery('');
    input.current?.focus();
  };

  const activate = async (option: Option): Promise<void> => {
    const action = option.action;
    if (action.kind === 'go') { onClose(); goTo(action.href, (href) => router.push(href)); return; }
    if (action.kind === 'mode') { setMode('switch'); setQuery(''); input.current?.focus(); return; }
    if (action.kind === 'copy') {
      try {
        await navigator.clipboard.writeText(action.text);
        toast(s.copied(action.text));
        onClose();
      } catch {
        toast(s.copyFailed, { tone: 'error' });
      }
      return;
    }
    if (switching) return;
    if (action.clientId === activeClientId) { onClose(); return; }
    if (await switchTo(action.clientId)) onClose();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => nextIndex(e.key, Math.min(i, flat.length - 1), flat.length) ?? i);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const option = current >= 0 ? flat[current] : undefined;
      if (option) void activate(option);
      return;
    }
    if (e.key === 'Backspace' && mode === 'switch' && query === '') {
      e.preventDefault();
      backToCommands();
    }
  };

  const loading = status.kind === 'loading';
  const resultCount = results && searching ? flat.length : null;
  const announcement = loading ? s.loading : status.kind === 'failed' ? '' : resultCount !== null ? s.count(resultCount) : '';
  let index = -1;

  return (
    <Dialog open={open} onClose={onClose} title={s.title} size="lg" initialFocus={input} placement="top">
      <div className="sticky top-0 z-sticky -mt-3 bg-raised pb-1 pt-1">
        <div className="relative flex items-center gap-2">
          {mode === 'switch' ? (
            <IconButton label={s.back} icon={<IconArrowLeft size={18} />} onClick={backToCommands} tooltipAlign="start" />
          ) : (
            <span aria-hidden className="pointer-events-none absolute left-3 text-muted"><IconSearch size={18} /></span>
          )}
          <Input
            ref={input}
            size="lg"
            role="combobox"
            aria-expanded={flat.length > 0}
            aria-controls={listId}
            aria-activedescendant={activeId ?? undefined}
            aria-autocomplete="list"
            aria-label={mode === 'switch' ? s.switchPlaceholder : s.label}
            placeholder={mode === 'switch' ? s.switchPlaceholder : s.placeholder}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            autoComplete="off"
            spellCheck={false}
            className={cx(mode === 'switch' ? '' : 'pl-10', loading && 'pr-10')}
          />
          {loading ? <span className="pointer-events-none absolute right-3 text-muted"><Spinner size={16} /></span> : null}
        </div>
      </div>
      <p role="status" className="sr-only">{announcement}</p>
      {/* Anchored at the top (placement), so results grow downwards and the field never moves. */}
      <div>
        {mode === 'root' && text.length > 0 && text.length < MIN_TEXT ? <p className="px-1 pb-2 text-small text-muted">{s.short}</p> : null}
        {loading && !results ? (
          <p aria-hidden className="flex items-center gap-2 px-1 py-3 text-small text-muted"><Spinner size={14} />{s.loading}</p>
        ) : null}
        {status.kind === 'failed' ? (
          <div role="alert" className="mb-2 flex flex-wrap items-center gap-3 rounded-md bg-danger-tint px-3 py-2 text-small text-danger-ink">
            <span className="flex-1">{s.failed}</span>
            <Button size="sm" onClick={() => setRetry((n) => n + 1)}>{s.retry}</Button>
          </div>
        ) : null}
        {status.kind === 'done' && flat.length === 0 ? (
          <div className="px-1 py-6 text-center">
            <p className="text-data font-medium">{s.none(text)}</p>
            <p className="mt-1 text-small text-muted">{s.noneHint}</p>
          </div>
        ) : null}
        {mode === 'switch' && flat.length === 0 ? <p className="px-1 py-6 text-center text-small text-muted">{ta.shellX.client.noMatch}</p> : null}
        <div id={listId} role="listbox" aria-label={s.results} className={cx('-mx-2 mt-1', loading && 'opacity-70')}>
          {visible.map((g) => (
            <div key={g.key} role="group" aria-labelledby={`${listId}-${g.key}`} className="pb-1">
              <div role="presentation" id={`${listId}-${g.key}`} className="px-3 pb-1 pt-2 text-micro text-subtle"><span className="font-semibold uppercase tracking-wide">{g.label}</span>{g.hint ? <span className="ml-1.5">{g.hint}</span> : null}</div>
              {g.options.map((o) => {
                index += 1;
                const at = index;
                const selected = at === current;
                return (
                  <div
                    key={o.key}
                    id={optionId(at)}
                    role="option"
                    aria-selected={selected}
                    onPointerMove={() => { if (!selected) setActive(at); }}
                    onClick={() => { void activate(o); }}
                    className={cx('flex cursor-pointer items-center gap-3 rounded-sm px-3 py-2', selected ? 'bg-brand-tint text-brand-ink' : 'text-fg')}
                  >
                    <span aria-hidden className={cx('shrink-0', selected ? 'text-brand-ink' : 'text-muted')}>{o.icon}</span>
                    <span className="min-w-0 flex-1">
                      <span className={cx('block truncate text-data', o.mono && 'font-mono')}>{o.label}</span>
                      {o.detail ? <span className={cx('block truncate text-micro', selected ? 'text-brand-ink' : 'text-muted')}>{o.detail}</span> : null}
                    </span>
                    {switching && o.action.kind === 'switch' && o.action.clientId === switching ? <Spinner size={14} label={ta.shellX.client.switching} /> : null}
                    {selected && o.action.kind === 'copy' ? <span className="hidden shrink-0 text-micro sm:inline">{s.copyHint}</span> : null}
                    {o.meta ? <span className="shrink-0">{o.meta}</span> : null}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <p aria-hidden className="mt-2 hidden flex-wrap items-center gap-x-3 gap-y-1 border-t border-line pt-2 text-micro text-muted sm:flex">
        <span className="inline-flex items-center gap-1"><Kbd>↑</Kbd><Kbd>↓</Kbd> {s.keys.move}</span>
        <span className="inline-flex items-center gap-1"><Kbd>Enter</Kbd> {s.keys.open}</span>
        <span className="inline-flex items-center gap-1"><Kbd>Esc</Kbd> {s.keys.close}</span>
        {mode === 'switch' ? <span className="inline-flex items-center gap-1"><Kbd>⌫</Kbd> {s.keys.back}</span> : null}
      </p>
    </Dialog>
  );
}
