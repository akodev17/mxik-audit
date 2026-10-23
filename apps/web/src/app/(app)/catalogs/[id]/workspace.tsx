'use client';

import { useInfiniteQuery, useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { api } from '@/lib/api/browser';
import { isNetworkFailure } from '@/lib/api-failure';
import { useI18n } from '@/lib/locale-client';
import { apiFilter, filterKey, OPTIONAL_COLUMNS, readHidden, type OptionalColumn, type ViewParams, type WsFilter } from '@/lib/workspace-url';
import { Button } from '@/ui/button';
import type { ConfirmResult } from '@/ui/confirm-dialog';
import { cx } from '@/ui/cx';
import { EmptyState } from '@/ui/empty-state';
import { IconSearch } from '@/ui/icons';
import { useToast } from '@/ui/toast';
import { BulkBar } from './bulk-bar';
import { CardList } from './card-list';
import { fitLayout } from './columns';
import { Completion } from './completion';
import { DrawerResize } from './drawer-resize';
import { buildEntries, entryId, entryRow, nextPendingIndex } from './entries';
import { FilterChips } from './filter-chips';
import { useFilterNav } from './filter-controls';
import { Grid, type GridHandlers } from './grid';
import { OnboardingHint } from './onboarding-hint';
import { RowDrawer } from './row-drawer';
import { ShortcutHelp } from './shortcut-help';
import { ShortcutHint } from './shortcut-hint';
import { keysReachWorkspace, ownsKeys, shortcutFor } from './shortcuts';
import { SummaryStrip } from './summary-strip';
import { SureAcceptDialog } from './sure-accept-dialog';
import { Toolbar } from './toolbar';
import { useDecisions, type MapRows } from './use-decisions';
import { useDrawerWidth } from './use-drawer-width';
import { PHONE_QUERY, TOUCH_QUERY, useMedia } from './use-media';
import { useWidth } from './use-width';
import { decisionText, shortName } from './ws-text';
import type { BulkActionInput, Counts, GridRow, ManyOutcome, RowsPage, WsSummary } from './ws-types';
import { serverChange } from '@/ui/shell/router-cache';

export type WorkspaceProps = {
  catalogId: string;
  clientId: string;
  /** The workspace totals as the page read them; refetched after changes to many rows. */
  summary: WsSummary;
  /** Rows matching the filter, and findings per type chip under the rest of the filter. */
  counts: Counts;
  /** The first page of rows (and the cursor of the next) as the page read them. */
  firstPage: RowsPage;
  filter: WsFilter;
  /** A finding a link asked for (?row=): its drawer opens once and the grid scrolls to it. Always on the first page. */
  focusRow: string | null;
  /** Storage key for the one-time demo tips; null when they do not apply. */
  hintKey: string | null;
  /** Viewers see everything and change nothing. */
  readOnly: boolean;
  /** Set by a saved view (URL); otherwise what the user last chose in this browser. */
  initialDensity: 'compact' | 'comfortable' | null;
  initialGrouped: boolean;
  initialHidden: OptionalColumn[] | null;
  /** Why views cannot be saved (viewer, demo); null when they can. */
  saveBlocked: string | null;
  exportLocked: boolean;
};

const DENSITY_KEY = 'mxik.density';
const COLUMNS_KEY = 'mxik.columns.hidden';

/** Rows, totals and counts of one catalogue and filter in React Query's cache. */
const keys = {
  rows: (catalogId: string, filter: string) => ['catalog', catalogId, 'rows', filter] as const,
  summary: (catalogId: string) => ['catalog', catalogId, 'summary'] as const,
  counts: (catalogId: string, filter: string) => ['catalog', catalogId, 'counts', filter] as const,
};

export function Workspace(props: WorkspaceProps) {
  const { catalogId, filter, readOnly } = props;
  const { ta } = useI18n();
  const x = ta.wsX;
  const toast = useToast();
  const queryClient = useQueryClient();
  const fkey = filterKey(filter);
  const go = useFilterNav();
  const phone = useMedia(PHONE_QUERY);
  const touch = useMedia(TOUCH_QUERY);
  const [drawerWidth, setDrawerWidth] = useDrawerWidth();

  // The page's reads seed the cache, and nothing refetches on its own: the rows carry optimistic
  // decisions. Leaving the workspace drops them, so the next visit starts from the page's reads.
  const summaryQuery = useQuery({
    queryKey: keys.summary(catalogId),
    queryFn: ({ signal }) => api.catalogs.summary({ catalogId }, { signal }),
    initialData: props.summary, staleTime: Infinity, gcTime: 0,
  });
  const countsQuery = useQuery({
    queryKey: keys.counts(catalogId, fkey),
    queryFn: ({ signal }) => api.workspace.counts({ catalogId, ...apiFilter(filter) }, { signal }),
    initialData: props.counts, staleTime: Infinity, gcTime: 0,
  });
  const rowsKey = useMemo(() => keys.rows(catalogId, fkey), [catalogId, fkey]);
  const pages = useInfiniteQuery({
    queryKey: rowsKey,
    queryFn: async ({ pageParam, signal }) => {
      const page = await api.workspace.rows({ catalogId, ...apiFilter(filter), cursor: pageParam }, { signal });
      if (!page) throw new Error('no data');
      return page;
    },
    initialPageParam: '',
    getNextPageParam: (last) => last.next ?? undefined,
    initialData: { pages: [props.firstPage], pageParams: [''] },
    staleTime: Infinity, gcTime: 0, retry: false,
  });
  // A new server render (router.refresh from the header) brings fresh totals.
  useEffect(() => { queryClient.setQueryData(keys.summary(catalogId), props.summary); }, [queryClient, catalogId, props.summary]);
  useEffect(() => { queryClient.setQueryData(keys.counts(catalogId, fkey), props.counts); }, [queryClient, catalogId, fkey, props.counts]);
  const summary = summaryQuery.data;
  const { count: filterCount, chips } = countsQuery.data;

  // A row seen on an earlier page keeps its place (the linked row may come again later).
  const rows = useMemo(() => {
    const seen = new Set<string>();
    return (pages.data?.pages ?? []).flatMap((p) => p.rows).filter((r) => {
      if (seen.has(r.findingId)) return false;
      seen.add(r.findingId);
      return true;
    });
  }, [pages.data]);
  const mapRows: MapRows = useCallback((fn) => {
    queryClient.setQueryData<InfiniteData<RowsPage, string>>(rowsKey, (cur) => cur && { ...cur, pages: cur.pages.map((p) => ({ ...p, rows: p.rows.map(fn) })) });
  }, [queryClient, rowsKey]);

  const [delta, setDelta] = useState(0);
  const [message, setMessage] = useState('');
  const onReviewed = useCallback((d: number) => setDelta((v) => v + d), []);
  // After a change to many rows (some maybe not loaded) the server recounts totals and chips.
  const recount = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: keys.summary(catalogId), exact: true });
    void queryClient.invalidateQueries({ queryKey: keys.counts(catalogId, fkey), exact: true });
  }, [queryClient, catalogId, fkey]);
  // A fresh server summary already counts what the local delta tracked.
  useEffect(() => { setDelta(0); }, [summaryQuery.dataUpdatedAt]);
  const { apply, applyGroup, applyMany, reportMany, revert, flagMany, setCommentMeta, ungroup } = useDecisions(rows, mapRows, onReviewed, setMessage, recount);

  const next = pages.hasNextPage ? 'more' : null;
  const loadFailed = pages.isFetchNextPageError && !pages.isFetchingNextPage;
  const loading = useRef(false);
  const [compact, setCompact] = useState(false);
  const [grouped, setGrouped] = useState(props.initialGrouped);
  const [hidden, setHidden] = useState<OptionalColumn[]>(props.initialHidden ?? []);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [tips, setTips] = useState(props.hintKey !== null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [allFiltered, setAllFiltered] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [sureOpen, setSureOpen] = useState(false);
  const anchor = useRef<string | null>(null);
  // State rather than a ref: the grid's virtualizer reads it in its own layout effect, which runs
  // before this parent's ref is attached, and a state update re-renders the grid once it exists.
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  // A saved view (through the URL) wins; otherwise this browser's last choice.
  useEffect(() => {
    if (props.initialDensity) { setCompact(props.initialDensity === 'compact'); return; }
    try { setCompact(localStorage.getItem(DENSITY_KEY) === 'compact'); } catch { /* storage blocked */ }
  }, [props.initialDensity]);
  useEffect(() => { setGrouped(props.initialGrouped); }, [props.initialGrouped]);
  const hiddenKey = props.initialHidden?.join(',') ?? null;
  useEffect(() => {
    if (hiddenKey !== null) { setHidden(readHidden(hiddenKey)); return; }
    try { setHidden(readHidden(localStorage.getItem(COLUMNS_KEY))); } catch { /* storage blocked */ }
  }, [hiddenKey]);

  const gridWidth = useWidth(scrollEl);
  const openRow = openId ? rows.find((r) => r.findingId === openId) ?? null : null;
  // With the drawer beside it the grid drops optional columns rather than scroll under the sticky decision column.
  const besideDrawer = openRow !== null && !phone;
  const layout = useMemo(() => fitLayout(hidden, !readOnly, besideDrawer ? gridWidth : null), [hidden, readOnly, besideDrawer, gridWidth]);
  const entries = useMemo(() => buildEntries(rows, grouped, expanded), [rows, grouped, expanded]);
  const found = entries.findIndex((e) => entryId(e) === activeKey);
  const activeIndex = entries.length === 0 ? -1 : found >= 0 ? found : 0;
  const activeEntry = entries[activeIndex];
  const selectable = useMemo(() => rows.filter((r) => r.decision === 'pending').map((r) => r.findingId), [rows]);
  const allChecked = selectable.length > 0 && selectable.every((id) => selected.has(id));
  const selectedIds = useMemo(() => [...selected], [selected]);
  const reviewed = Math.min(summary.riskyFindings, summary.reviewed + delta);
  const allDone = summary.riskyFindings > 0 && reviewed >= summary.riskyFindings;

  const focusGrid = useCallback(() => {
    const el = document.activeElement;
    if (!el || el === document.body || gridRef.current?.contains(el)) gridRef.current?.focus({ preventScroll: true });
  }, []);

  // A link to one finding opens it once; the grid scrolls to the active row. The URL forgets it,
  // so a later filter change does not open it again.
  const focused = useRef<string | null>(null);
  useEffect(() => {
    const id = props.focusRow;
    if (!id || focused.current === id) return;
    focused.current = id;
    const row = rows.find((r) => r.findingId === id);
    if (!row) return;
    const group = row.groupKey;
    if (grouped && group) setExpanded((cur) => new Set(cur).add(group));
    setActiveKey(id);
    setOpenId(id);
    const url = new URL(window.location.href);
    url.searchParams.delete('row');
    window.history.replaceState(null, '', url);
  }, [props.focusRow, rows, grouped]);

  // The active row, announced politely for screen readers.
  useEffect(() => {
    const row = entryRow(activeEntry);
    if (!activeKey || !row) return;
    setMessage(x.a11y.row(String(row.rowIndex + 1), shortName(row.productName), decisionText(row, ta)));
  }, [activeKey, activeEntry, ta, x]);

  const { fetchNextPage } = pages;
  const loadMore = useCallback(async () => {
    if (!next || loading.current) return;
    loading.current = true;
    try {
      await fetchNextPage({ cancelRefetch: false });
    } finally {
      loading.current = false;
    }
  }, [next, fetchNextPage]);

  const select = useCallback((index: number) => {
    const entry = entries[index];
    if (!entry) return;
    setActiveKey(entryId(entry));
    const row = entryRow(entry);
    if (entry.kind === 'row' && row) setOpenId(row.findingId);
  }, [entries]);

  const goTo = useCallback((index: number) => {
    const entry = entries[index];
    if (!entry) return;
    setActiveKey(entryId(entry));
    const row = entryRow(entry);
    // The drawer follows the active row only while it is open.
    setOpenId((cur) => (cur && row && entry.kind === 'row' ? row.findingId : cur));
  }, [entries]);

  const move = useCallback((step: number) => goTo(Math.max(0, Math.min(entries.length - 1, activeIndex + step))), [goTo, entries.length, activeIndex]);

  const nextPending = useCallback(() => {
    const i = nextPendingIndex(entries, activeIndex);
    if (i >= 0) goTo(i);
    else if (next) void loadMore();
  }, [entries, activeIndex, goTo, next, loadMore]);

  /** After a decision, on to the next row still waiting. */
  const advanceFrom = useCallback((findingId: string) => {
    const index = entries.findIndex((e) => e.kind === 'row' && e.row.findingId === findingId);
    const i = nextPendingIndex(entries, index);
    if (i >= 0) goTo(i);
  }, [entries, goTo]);

  const pick = useCallback((row: GridRow) => {
    if (readOnly || row.decision !== 'pending') return;
    if (!phone && layout.keys.includes('suggested')) { setEditingId(row.findingId); return; }
    setActiveKey(row.findingId);
    setOpenId(row.findingId);
  }, [readOnly, phone, layout.keys]);

  const accept = useCallback((row: GridRow, chosen?: { code: string; name: string }) => {
    if (readOnly || row.decision !== 'pending') return;
    if (row.mode === 'pick' && !chosen) { pick(row); return; }
    void apply(row.findingId, 'accepted', chosen);
    advanceFrom(row.findingId);
    focusGrid();
  }, [readOnly, pick, apply, advanceFrom, focusGrid]);

  const reject = useCallback((row: GridRow) => {
    if (readOnly || row.decision !== 'pending') return;
    void apply(row.findingId, 'rejected');
    advanceFrom(row.findingId);
    focusGrid();
  }, [readOnly, apply, advanceFrom, focusGrid]);

  // A decision recorded without an event (older data) is reopened on its own.
  const undoRow = useCallback((row: GridRow) => {
    if (readOnly || row.decision === 'pending') return;
    void revert(row.decisionEventId ? { eventId: row.decisionEventId, findingId: row.findingId } : { reopen: row.findingId });
  }, [readOnly, revert]);

  const undoLast = useCallback(async () => {
    if (readOnly) return;
    const id = await revert({ lastInCatalog: catalogId });
    if (id && rows.some((r) => r.findingId === id)) setActiveKey(id);
  }, [readOnly, revert, catalogId, rows]);

  const decideGroup = useCallback((group: GridRow[], decision: 'accepted' | 'rejected') => {
    if (readOnly) return;
    void applyGroup(group, decision);
  }, [applyGroup, readOnly]);

  const onCheck = useCallback((index: number, shift: boolean) => {
    const entry = entries[index];
    if (!entry || entry.kind !== 'row') return;
    const id = entry.row.findingId;
    setAllFiltered(false);
    setSelected((cur) => {
      const nextSet = new Set(cur);
      const from = shift && anchor.current ? entries.findIndex((e) => e.kind === 'row' && e.row.findingId === anchor.current) : -1;
      if (from >= 0) {
        const [lo, hi] = from < index ? [from, index] : [index, from];
        for (let i = lo; i <= hi; i++) {
          const e = entries[i];
          if (e?.kind === 'row' && e.row.decision === 'pending') nextSet.add(e.row.findingId);
        }
      } else if (nextSet.has(id)) nextSet.delete(id); else nextSet.add(id);
      return nextSet;
    });
    anchor.current = id;
  }, [entries]);

  const onCheckAll = useCallback((checked: boolean) => {
    setAllFiltered(false);
    setSelected(checked ? new Set(selectable) : new Set());
  }, [selectable]);

  const runBulk = useCallback(async (action: BulkActionInput, picked?: { code: string; name: string }, inDialog = false): Promise<ConfirmResult> => {
    if (readOnly) return { ok: false };
    setBulkBusy(true);
    try {
      const target = allFiltered ? { filter: apiFilter(filter) } : { ids: [...selected] };
      const result = await serverChange(api.workspace.bulkApply({ catalogId, target, action }));
      if (!result.ok) {
        if (!inDialog) toast(result.error, { tone: 'error' });
        return { ok: false, error: result.error };
      }
      if (action.kind === 'flag') flagMany(result.ids, action.flag, result.eventId);
      else {
        applyMany({
          ids: result.ids, eventId: result.eventId, decision: action.kind === 'reject' ? 'rejected' : 'accepted',
          code: action.kind === 'assign' ? action.code : null, name: picked?.name ?? null, source: 'bulk',
        });
        reportMany(result);
      }
      setSelected(new Set());
      setAllFiltered(false);
      return { ok: true };
    } catch (error) {
      const text = isNetworkFailure(error) ? x.toast.network : x.toast.failed;
      if (!inDialog) toast(text, { tone: 'error' });
      return { ok: false, error: text };
    } finally {
      setBulkBusy(false);
    }
  }, [readOnly, allFiltered, filter, selected, catalogId, toast, flagMany, applyMany, reportMany, x]);

  const manyDone = useCallback((result: Extract<ManyOutcome, { ok: true }>, source: GridRow['decisionSource']) => {
    applyMany({ ids: result.ids, eventId: result.eventId, decision: 'accepted', source });
    reportMany(result);
  }, [applyMany, reportMany]);

  const acceptDict = useCallback(async () => {
    if (readOnly) return;
    setBulkBusy(true);
    try {
      const result = await serverChange(api.dictionary.acceptForCatalog({ catalogId }));
      if (!result.ok) { toast(result.error, { tone: 'error' }); return; }
      manyDone(result, 'dictionary');
    } catch (error) {
      toast(isNetworkFailure(error) ? x.toast.network : x.toast.failed, { tone: 'error' });
    } finally {
      setBulkBusy(false);
    }
  }, [readOnly, catalogId, toast, manyDone, x]);

  const split = useCallback(async (row: GridRow) => {
    try {
      const result = await serverChange(api.workspace.split({ findingId: row.findingId }));
      if (!result.ok) { toast(x.toast.failed, { tone: 'error' }); return; }
      ungroup(row.findingId);
      toast(x.toast.split);
    } catch (error) {
      toast(isNetworkFailure(error) ? x.toast.network : x.toast.failed, { tone: 'error' });
    }
  }, [toast, ungroup, x]);

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
    onPick: pick,
    onUndo: undoRow,
    onToggleGroup: toggleGroup,
    onGroup: decideGroup,
    onNeedMore: () => { void loadMore(); },
    onCheck,
    onCheckAll,
    onCancelEdit: () => setEditingId(null),
    onChoose: (row, code, name) => { setEditingId(null); accept(row, { code, name }); },
    onSort: (sort) => go((p) => { if (sort === 'risk') p.delete('sort'); else p.set('sort', sort); }),
  }), [select, accept, reject, pick, undoRow, toggleGroup, decideGroup, loadMore, onCheck, onCheckAll, go]);

  // Keys act on the workspace only: never while typing or on a control that owns its keys, never with modifiers.
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      const action = shortcutFor(e);
      if (!action || ownsKeys(e.target) || helpOpen || sureOpen) return;
      const target = e.target instanceof Node ? e.target : null;
      if (!keysReachWorkspace(target, rootRef.current, document.body)) return;
      const entry = entries[activeIndex];
      const row = entryRow(entry);
      const single = entry?.kind === 'row' ? entry.row : null;
      switch (action) {
        case 'next': e.preventDefault(); move(1); break;
        case 'prev': e.preventDefault(); move(-1); break;
        case 'nextPending': e.preventDefault(); nextPending(); break;
        case 'accept':
          if (!entry) return;
          e.preventDefault();
          // On a group header Enter only opens it; deciding a whole group takes a deliberate click.
          if (entry.kind === 'group') toggleGroup(entry.key);
          else if (single && single.decision === 'pending' && single.mode !== 'pick') accept(single);
          break;
        case 'reject': if (single && single.decision === 'pending') { e.preventDefault(); reject(single); } break;
        case 'edit': if (single) { e.preventDefault(); pick(single); } break;
        case 'open': if (row && entry?.kind === 'row') { e.preventDefault(); setOpenId(row.findingId); } break;
        case 'undo': e.preventDefault(); void undoLast(); break;
        case 'help': e.preventDefault(); setHelpOpen(true); break;
        case 'search': e.preventDefault(); searchRef.current?.focus(); searchRef.current?.select(); break;
        default: break;
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [entries, activeIndex, move, nextPending, accept, reject, pick, toggleGroup, undoLast, helpOpen, sureOpen]);

  const setDensity = (v: boolean): void => {
    setCompact(v);
    try { localStorage.setItem(DENSITY_KEY, v ? 'compact' : 'comfortable'); } catch { /* storage blocked */ }
  };
  const setColumns = (v: OptionalColumn[]): void => {
    setHidden(v);
    try { localStorage.setItem(COLUMNS_KEY, v.join(',')); } catch { /* storage blocked */ }
  };
  const applyView = (p: ViewParams): void => {
    setCompact(p.density === 'compact');
    setGrouped(p.grouped);
    setHidden(OPTIONAL_COLUMNS.filter((c) => p.hidden?.includes(c)));
  };

  const narrowed = filter.type !== null || filter.q !== '' || filter.flag !== 'any' || filter.commented || filter.source !== null;
  const showCompletion = allDone && filter.decision === 'pending';
  const drawerOpen = openRow !== null;
  const bulkOpen = !phone && !readOnly && (selected.size > 0 || allFiltered);
  const style = { '--drawer-width': `${drawerWidth}px` } as CSSProperties;

  let body: React.ReactNode;
  if (entries.length === 0) {
    body = showCompletion ? null
      : summary.riskyRows === 0 && !filter.type && !filter.q
        ? <EmptyState title={x.empty.clean} hint={x.empty.cleanHint} />
        : (
          <EmptyState
            icon={<IconSearch size={20} />} title={x.empty.title} hint={filter.q ? `${ta.wsUi.list.searchFor(filter.q)}. ${x.empty.hint}` : x.empty.hint}
            action={<Button size="sm" variant="secondary" onClick={() => go((p) => { for (const k of ['type', 'q', 'dec', 'flag', 'comments', 'sort', 'source']) p.delete(k); })}>{x.filter.reset}</Button>}
          />
        );
  } else if (phone) {
    body = (
      <CardList
        rows={entries.flatMap((e) => (e.kind === 'row' ? [e.row] : e.rows))} activeId={openId} hasMore={next !== null && !loadFailed}
        readOnly={readOnly}
        onOpen={(row) => { setActiveKey(row.findingId); setOpenId(row.findingId); }}
        onAccept={(row) => accept(row)} onReject={reject} onUndo={undoRow} onNeedMore={() => { void loadMore(); }}
      />
    );
  } else {
    body = (
      <Grid
        entries={entries} total={grouped ? null : filterCount} found={filterCount} activeIndex={activeIndex} compact={compact} expanded={expanded}
        hasMore={next !== null && !loadFailed} ended={next === null} sort={filter.sort}
        scrollEl={scrollEl} gridRef={gridRef} handlers={handlers} readOnly={readOnly}
        selected={selected} allChecked={allChecked} editingId={editingId} layout={layout}
      />
    );
  }

  return (
    <div ref={rootRef} style={style} className="relative flex min-h-0 flex-1 flex-col">
      <div aria-live="polite" className="sr-only">{message}</div>
      <SummaryStrip summary={summary} reviewedDelta={delta} />
      {showCompletion ? (
        <Completion
          catalogId={catalogId} clientId={props.clientId} findings={summary.riskyFindings} exportLocked={props.exportLocked}
          onShowDecided={() => go((p) => p.set('dec', 'all'))}
        />
      ) : null}
      <Toolbar
        filter={filter} count={filterCount} compact={compact} grouped={grouped} hidden={hidden} phone={phone} touch={touch}
        readOnly={readOnly} busy={bulkBusy} saveBlocked={props.saveBlocked} searchRef={searchRef}
        surePending={summary.surePending} dictionaryPending={summary.dictionaryPending} partialGroups={next !== null}
        onCompact={setDensity} onGrouped={setGrouped} onHidden={setColumns} onApplyView={applyView}
        onAcceptSure={() => setSureOpen(true)} onAcceptDictionary={() => { void acceptDict(); }} onHelp={() => setHelpOpen(true)}
      />
      <FilterChips summary={summary} chips={chips} filter={filter} />
      <div className={cx('relative flex flex-col md:min-h-0 md:flex-1', drawerOpen && 'lg:mr-(--drawer-width)')}>
        {/* While the bulk bar floats over the grid, the list can scroll its last rows above it. */}
        <div ref={setScrollEl} className={cx('relative md:min-h-0 md:flex-1 md:overflow-auto', bulkOpen && 'pb-24')}>
          {body}
          {next !== null && !loadFailed && entries.length > 0 ? <p className="sr-only">{x.load.more}</p> : null}
          {loadFailed ? (
            <div role="alert" className="flex flex-wrap items-center justify-center gap-3 border-t border-line p-4 text-small">
              <span className="text-danger-ink">{x.load.failed} {x.load.failedHint}</span>
              <Button size="sm" onClick={() => { void loadMore(); }}>{x.load.retry}</Button>
            </div>
          ) : null}
        </div>
        {bulkOpen ? (
          <BulkBar
            catalogId={catalogId} filter={filter}
            count={allFiltered ? filterCount : selected.size}
            ids={selectedIds} everyLoaded={allChecked && selected.size > 1}
            filterTotal={allChecked && filterCount > selected.size ? filterCount : null} allFiltered={allFiltered} busy={bulkBusy}
            onSelectFiltered={() => setAllFiltered(true)}
            onClear={() => { setSelected(new Set()); setAllFiltered(false); }}
            onRun={runBulk}
          />
        ) : null}
      </div>
      <ShortcutHint suppressed={tips} touch={touch || phone} onHelp={() => setHelpOpen(true)} />
      {props.hintKey ? <OnboardingHint storageKey={props.hintKey} onDone={() => setTips(false)} /> : null}
      {drawerOpen && !phone ? <DrawerResize width={drawerWidth} onWidth={setDrawerWidth} /> : null}
      <RowDrawer
        row={openRow} readOnly={readOnly} phone={phone} touch={touch}
        canSplit={grouped && Boolean(openRow?.groupKey)}
        onClose={() => { setOpenId(null); focusGrid(); }}
        onAccept={() => { if (openRow) accept(openRow); }}
        onReject={() => { if (openRow) reject(openRow); }}
        onUndo={() => { if (openRow) undoRow(openRow); }}
        onChoose={(code, name) => { if (openRow) accept(openRow, { code, name }); }}
        onComments={(n, flag) => { if (openRow) setCommentMeta(openRow.findingId, n, flag); }}
        onSplit={() => { if (openRow) void split(openRow); }}
      />
      <ShortcutHelp open={helpOpen} onClose={() => setHelpOpen(false)} />
      {readOnly ? null : (
        <SureAcceptDialog
          open={sureOpen} catalogId={catalogId} filter={filter} filterNarrows={narrowed}
          onClose={() => setSureOpen(false)} onDone={(result) => manyDone(result, 'bulk_sure')}
        />
      )}
    </div>
  );
}
