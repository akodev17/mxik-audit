'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { acceptDictionary } from '@/app/actions/dictionary';
import { acceptAllAbove } from '@/app/actions/review';
import { ta } from '@/lib/i18n-app';
import type { WsSummary } from '@/lib/workspace';
import type { GridRow } from '@/lib/workspace-rows';
import { Button } from '@/ui/button';
import { EmptyState } from '@/ui/empty-state';
import { useToast } from '@/ui/toast';
import { buildEntries, entryId, entryRow } from './entries';
import { Grid, type GridHandlers } from './grid';
import { OnboardingHint } from './onboarding-hint';
import { RowDrawer } from './row-drawer';
import { ShortcutHint } from './shortcut-hint';
import { SummaryStrip } from './summary-strip';
import { Toolbar } from './toolbar';
import { useDecisions } from './use-decisions';

export type WorkspaceProps = {
  catalogId: string;
  summary: WsSummary;
  initialRows: GridRow[];
  initialNext: string | null;
  count: number;
  filter: { type: string | null; q: string; pendingOnly: boolean };
  /** Storage key for the one-time demo tips; null when they do not apply. */
  hintKey: string | null;
  /** Viewers see everything and change nothing. */
  readOnly: boolean;
};

const isTyping = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable);

const DENSITY_KEY = 'mxik.density';

export function Workspace({ catalogId, summary, initialRows, initialNext, count, filter, hintKey, readOnly }: WorkspaceProps) {
  const toast = useToast();
  const [delta, setDelta] = useState(0);
  const onReviewed = useCallback((d: number) => setDelta((x) => x + d), []);
  const { rows, apply, applyGroup, revert, append, markSure, markDictionary } = useDecisions(initialRows, onReviewed);

  const [next, setNext] = useState(initialNext);
  const [loadFailed, setLoadFailed] = useState(false);
  const loading = useRef(false);
  const [compact, setCompact] = useState(false);
  const [grouped, setGrouped] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [tips, setTips] = useState(hintKey !== null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    try { setCompact(localStorage.getItem(DENSITY_KEY) === 'compact'); } catch { /* storage blocked */ }
  }, []);

  const entries = useMemo(() => buildEntries(rows, grouped, expanded), [rows, grouped, expanded]);
  const found = entries.findIndex((e) => entryId(e) === activeKey);
  const activeIndex = entries.length === 0 ? -1 : found >= 0 ? found : 0;
  const openRow = openId ? rows.find((r) => r.findingId === openId) ?? null : null;

  const loadMore = useCallback(async () => {
    if (!next || loading.current) return;
    loading.current = true;
    setLoadFailed(false);
    try {
      const qs = new URLSearchParams({ cursor: next, pending: filter.pendingOnly ? '1' : '0' });
      if (filter.type) qs.set('type', filter.type);
      if (filter.q) qs.set('q', filter.q);
      const res = await fetch(`/api/catalogs/${catalogId}/rows?${qs}`);
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { rows: GridRow[]; next: string | null };
      append(data.rows);
      setNext(data.next);
    } catch {
      setLoadFailed(true);
    } finally {
      loading.current = false;
    }
  }, [next, filter, catalogId, append]);

  const select = useCallback((index: number) => {
    const entry = entries[index];
    if (!entry) return;
    setActiveKey(entryId(entry));
    const row = entryRow(entry);
    if (entry.kind === 'row' && row) setOpenId(row.findingId);
  }, [entries]);

  /** Moves to the next row still waiting for a decision (the next risky row). */
  const advance = useCallback((from: number) => {
    for (let i = from + 1; i < entries.length; i++) {
      const row = entryRow(entries[i]);
      if (row?.decision === 'pending') {
        setActiveKey(entryId(entries[i] as (typeof entries)[number]));
        setOpenId((cur) => (cur && row ? row.findingId : cur));
        return;
      }
    }
  }, [entries]);

  const move = useCallback((step: number) => {
    const i = Math.max(0, Math.min(entries.length - 1, activeIndex + step));
    const entry = entries[i];
    if (!entry) return;
    setActiveKey(entryId(entry));
    const row = entryRow(entry);
    setOpenId((cur) => (cur && row && entry.kind === 'row' ? row.findingId : cur));
  }, [entries, activeIndex]);

  const accept = useCallback((row: GridRow, chosen?: { code: string; name: string | null }) => {
    if (readOnly) return;
    const index = entries.findIndex((e) => e.kind === 'row' && e.row.findingId === row.findingId);
    void apply(row.findingId, 'accepted', chosen);
    if (index >= 0) advance(index);
  }, [apply, advance, entries, readOnly]);

  const reject = useCallback((row: GridRow) => {
    if (readOnly) return;
    const index = entries.findIndex((e) => e.kind === 'row' && e.row.findingId === row.findingId);
    void apply(row.findingId, 'rejected');
    if (index >= 0) advance(index);
  }, [apply, advance, entries, readOnly]);

  const decideGroup = useCallback((group: GridRow[], decision: 'accepted' | 'rejected') => {
    if (readOnly) return;
    void applyGroup(group, decision);
    const index = entries.findIndex((e) => e.kind === 'group' && e.rows === group);
    if (index >= 0) advance(index);
  }, [applyGroup, advance, entries, readOnly]);

  const toggleGroup = useCallback((key: string) => {
    setExpanded((cur) => {
      const nextSet = new Set(cur);
      if (nextSet.has(key)) nextSet.delete(key); else nextSet.add(key);
      return nextSet;
    });
  }, []);

  const handlers: GridHandlers = useMemo(() => ({
    onSelect: select,
    onAccept: (row) => accept(row),
    onReject: reject,
    onUndo: (row) => { if (!readOnly && row.decisionEventId) void revert({ eventId: row.decisionEventId, findingId: row.findingId }); },
    onToggleGroup: toggleGroup,
    onGroup: decideGroup,
    onNeedMore: () => { void loadMore(); },
  }), [select, accept, reject, revert, toggleGroup, decideGroup, loadMore, readOnly]);

  const acceptSure = useCallback(async () => {
    if (readOnly) return;
    setBulkBusy(true);
    const result = await acceptAllAbove({ catalogId, minConfidence: 0.9 });
    setBulkBusy(false);
    if (!result.ok) { toast(ta.ws.failedToast, { tone: 'error' }); return; }
    toast(ta.ws.bulkToast(result.count));
    onReviewed(markSure(0.9));
  }, [catalogId, toast, markSure, onReviewed, readOnly]);

  const acceptDict = useCallback(async () => {
    if (readOnly) return;
    setBulkBusy(true);
    const result = await acceptDictionary(catalogId);
    setBulkBusy(false);
    if (!result.ok) { toast(ta.ws.failedToast, { tone: 'error' }); return; }
    toast(ta.ws.bulkToast(result.count));
    onReviewed(markDictionary());
  }, [catalogId, toast, markDictionary, onReviewed, readOnly]);

  // Keys apply to the workspace, never while typing and never to the browser's own shortcuts.
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      const target = e.target as HTMLElement | null;
      if (target && target !== document.body && !rootRef.current?.contains(target)) return;
      const entry = entries[activeIndex];
      const row = entryRow(entry);
      switch (e.key) {
        case 'j': case 'ArrowDown': e.preventDefault(); move(1); break;
        case 'k': case 'ArrowUp': e.preventDefault(); move(-1); break;
        case 'Enter':
          if (target?.tagName === 'BUTTON' || target?.tagName === 'A' || !entry) return;
          e.preventDefault();
          if (entry.kind === 'group') decideGroup(entry.rows, 'accepted');
          else if (row && row.decision === 'pending' && row.suggestedMxik && !row.noSuggestion) accept(row);
          break;
        case 'r':
          if (!entry) return;
          e.preventDefault();
          if (entry.kind === 'group') decideGroup(entry.rows, 'rejected');
          else if (row) reject(row);
          break;
        case 'o': if (row && entry?.kind === 'row') { e.preventDefault(); setOpenId(row.findingId); } break;
        case 'u': e.preventDefault(); if (!readOnly) void revert({ lastInCatalog: catalogId }); break;
        case '/': e.preventDefault(); document.getElementById('app-search')?.focus(); break;
        default: break;
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [entries, activeIndex, move, accept, reject, decideGroup, revert, catalogId, readOnly]);

  const setDensity = (v: boolean): void => {
    setCompact(v);
    try { localStorage.setItem(DENSITY_KEY, v ? 'compact' : 'comfortable'); } catch { /* storage blocked */ }
  };

  const drawerOffset = openRow ? 'lg:mr-[460px]' : '';
  return (
    <div ref={rootRef} className="flex min-h-0 flex-1 flex-col">
      <SummaryStrip summary={summary} reviewedDelta={delta} activeType={filter.type} />
      <Toolbar
        count={count} compact={compact} grouped={grouped} pendingOnly={filter.pendingOnly} query={filter.q} busy={bulkBusy} readOnly={readOnly}
        onCompact={setDensity} onGrouped={setGrouped} onAcceptSure={() => { void acceptSure(); }}
        dictionaryPending={summary.dictionaryPending} onAcceptDictionary={() => { void acceptDict(); }}
      />
      <div ref={scrollRef} className={`min-h-0 flex-1 overflow-auto ${drawerOffset}`}>
        {entries.length === 0 ? (
          summary.riskyRows === 0 && !filter.type && !filter.q
            ? <EmptyState title={ta.ws.clean} hint={ta.ws.cleanHint} />
            : <EmptyState title={ta.ws.empty} hint={ta.ws.emptyHint} />
        ) : (
          <Grid
            entries={entries} activeIndex={activeIndex} compact={compact} expanded={expanded}
            hasMore={next !== null && !loadFailed} scrollRef={scrollRef} handlers={handlers} readOnly={readOnly}
          />
        )}
        {loadFailed ? (
          <div role="alert" className="flex items-center justify-center gap-3 border-t border-line p-4 text-sm">
            <span className="text-danger">{ta.ws.loadError}. {ta.ws.loadErrorHint}</span>
            <Button size="sm" onClick={() => { void loadMore(); }}>{ta.ws.retry}</Button>
          </div>
        ) : null}
      </div>
      <ShortcutHint suppressed={tips} />
      {hintKey ? <OnboardingHint storageKey={hintKey} onDone={() => setTips(false)} /> : null}
      <RowDrawer
        row={openRow} readOnly={readOnly}
        onClose={() => setOpenId(null)}
        onAccept={() => { if (openRow) accept(openRow); }}
        onReject={() => { if (openRow) reject(openRow); }}
        onUndo={() => { if (openRow?.decisionEventId) void revert({ eventId: openRow.decisionEventId, findingId: openRow.findingId }); }}
        onChoose={(code, name) => { if (openRow) accept(openRow, { code, name }); }}
      />
    </div>
  );
}
