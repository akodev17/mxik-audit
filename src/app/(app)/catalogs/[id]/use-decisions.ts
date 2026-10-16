'use client';

import { useCallback, useRef, useState } from 'react';
import { decide, decideGroup, undo } from '@/app/actions/review';
import { ta } from '@/lib/i18n-app';
import type { GridRow } from '@/lib/workspace-rows';
import { useToast } from '@/ui/toast';

const isRisky = (r: GridRow): boolean => r.severity === 'high' || r.severity === 'medium';

type Chosen = { code: string; name: string | null };

/** Row state with optimistic accept, reject and undo; never refetches the catalogue. */
export function useDecisions(initial: GridRow[], onReviewed: (delta: number) => void) {
  const toast = useToast();
  const [rows, setRows] = useState<GridRow[]>(initial);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  const patch = useCallback((ids: ReadonlySet<string>, fn: (r: GridRow) => GridRow) => {
    setRows((cur) => cur.map((r) => (ids.has(r.findingId) ? fn(r) : r)));
  }, []);

  const revert = useCallback(async (payload: { eventId: string; findingId?: string } | { lastInCatalog: string }) => {
    const result = await undo(payload);
    if (!result.ok) { toast(result.error, { tone: 'error' }); return; }
    const ids = new Set(result.findingIds);
    const risky = rowsRef.current.filter((r) => ids.has(r.findingId) && isRisky(r) && r.decision !== 'pending').length;
    patch(ids, (r) => ({ ...r, decision: 'pending', chosenMxik: null, chosenName: null, decisionEventId: null }));
    onReviewed(-risky);
    toast(ta.ws.undoneToast);
  }, [onReviewed, patch, toast]);

  const apply = useCallback(async (findingId: string, decision: 'accepted' | 'rejected', chosen?: Chosen) => {
    const row = rowsRef.current.find((r) => r.findingId === findingId);
    // A decided row is undone first; nothing is overwritten.
    if (!row || row.decision !== 'pending') return;
    const ids = new Set([findingId]);
    const code = decision === 'accepted' ? (chosen?.code ?? row.suggestedMxik) : null;
    const name = decision === 'accepted' ? (chosen?.name ?? row.suggestedName) : null;
    patch(ids, (r) => ({ ...r, decision, chosenMxik: code, chosenName: name }));
    if (isRisky(row)) onReviewed(1);

    const result = await decide({ findingId, decision, chosenMxik: chosen?.code ?? null });
    if (!result.ok) {
      patch(ids, (r) => ({ ...r, decision: 'pending', chosenMxik: null, chosenName: null }));
      if (isRisky(row)) onReviewed(-1);
      toast(ta.ws.failedToast, { tone: 'error' });
      return;
    }
    patch(ids, (r) => ({ ...r, decisionEventId: result.eventId }));
    toast(decision === 'accepted' ? ta.ws.acceptedToast : ta.ws.rejectedToast, {
      action: { label: ta.ws.undo, run: () => { void revert({ eventId: result.eventId, findingId }); } },
    });
  }, [onReviewed, patch, revert, toast]);

  const applyGroup = useCallback(async (group: readonly GridRow[], decision: 'accepted' | 'rejected') => {
    const targets = group.filter((r) => r.decision === 'pending');
    if (targets.length === 0) return;
    const ids = new Set(targets.map((r) => r.findingId));
    patch(ids, (r) => ({
      ...r, decision,
      chosenMxik: decision === 'accepted' ? r.suggestedMxik : null,
      chosenName: decision === 'accepted' ? r.suggestedName : null,
    }));
    const risky = targets.filter(isRisky).length;
    onReviewed(risky);

    const result = await decideGroup({ findingIds: [...ids], decision });
    if (!result.ok) {
      patch(ids, (r) => ({ ...r, decision: 'pending', chosenMxik: null, chosenName: null }));
      onReviewed(-risky);
      toast(ta.ws.failedToast, { tone: 'error' });
      return;
    }
    const events = new Map(result.decided.map((d) => [d.findingId, d.eventId]));
    setRows((cur) => cur.map((r) => (events.has(r.findingId) ? { ...r, decisionEventId: events.get(r.findingId) ?? null } : r)));
    toast(`${targets.length} ta qator: ${decision === 'accepted' ? ta.ws.acceptedToast : ta.ws.rejectedToast}`);
  }, [onReviewed, patch, toast]);

  /** Appends a freshly loaded page; rows already known keep their local state. */
  const append = useCallback((more: GridRow[]) => {
    setRows((cur) => {
      const known = new Set(cur.map((r) => r.findingId));
      return [...cur, ...more.filter((r) => !known.has(r.findingId))];
    });
  }, []);

  /** Marks pending rows at or above a confidence as accepted, after the server did; returns risky rows changed. */
  const markSure = useCallback((min: number): number => {
    const sure = (r: GridRow): boolean => r.decision === 'pending' && r.confidence !== null && r.confidence >= min && Boolean(r.suggestedMxik) && !r.noSuggestion;
    const risky = rowsRef.current.filter((r) => sure(r) && isRisky(r)).length;
    setRows((cur) => cur.map((r) => (sure(r) ? { ...r, decision: 'accepted', chosenMxik: r.suggestedMxik, chosenName: r.suggestedName } : r)));
    return risky;
  }, []);

  /** Marks pending dictionary suggestions accepted, after the server did. */
  const markDictionary = useCallback((): number => {
    const hit = (r: GridRow): boolean => r.decision === 'pending' && r.dictionary && Boolean(r.suggestedMxik);
    const risky = rowsRef.current.filter((r) => hit(r) && isRisky(r)).length;
    setRows((cur) => cur.map((r) => (hit(r) ? { ...r, decision: 'accepted', chosenMxik: r.suggestedMxik, chosenName: r.suggestedName } : r)));
    return risky;
  }, []);

  return { rows, apply, applyGroup, revert, append, markSure, markDictionary };
}
