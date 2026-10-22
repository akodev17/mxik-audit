'use client';

import { useCallback, useRef } from 'react';
import { fmtDateTime } from '@tasnivo/i18n/format';
import { api } from '@/lib/api/browser';
import { isNetworkFailure } from '@/lib/api-failure';
import { useI18n } from '@/lib/locale-client';
import { readDecisionSource } from '@/lib/workspace-url';
import { useToast } from '@/ui/toast';
import { count, shortName, skippedText } from './ws-text';
import type { DecideResult, GridRow, UndoTarget } from './ws-types';
import { serverChange } from '@/ui/shell/router-cache';

export type { UndoTarget };

const isRisky = (r: GridRow): boolean => r.severity === 'high' || r.severity === 'medium';

type Chosen = { code: string; name: string | null };
type Decision = 'accepted' | 'rejected';
type ManyApplied = { ids: readonly string[]; eventId: string | null; decision: Decision; code?: string | null; name?: string | null; source: GridRow['decisionSource'] };
/** Changes every loaded row (in the rows query's cache): the grid's single source of row state. */
export type MapRows = (fn: (r: GridRow) => GridRow) => void;

const PENDING = { decision: 'pending', chosenMxik: null, chosenName: null, decisionEventId: null, decisionSource: null } as const;

/**
 * Row state with optimistic decisions, kept in the rows query's cache. Every API call is wrapped
 * so a failure or a refused call puts the row back and says so; a row someone else decided
 * meanwhile is replaced with the server's state.
 */
export function useDecisions(rows: GridRow[], mapRows: MapRows, onReviewed: (delta: number) => void, announce: (text: string) => void, onManyChanged: () => void) {
  const { ta, locale } = useI18n();
  const x = ta.wsX.toast;
  const toast = useToast();
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  const patch = useCallback((ids: ReadonlySet<string>, fn: (r: GridRow) => GridRow) => {
    mapRows((r) => (ids.has(r.findingId) ? fn(r) : r));
  }, [mapRows]);

  /** A refused call (4xx) reads as "failed", no answer at all as the network message. */
  const failed = useCallback((error: unknown): string => (isNetworkFailure(error) ? x.network : x.failed), [x]);

  /** Reverts a decision event, or the user's own latest one; returns the first reverted finding id. */
  const revert = useCallback(async (target: UndoTarget): Promise<string | null> => {
    try {
      const result = await serverChange(api.workspace.undo(target));
      if (!result.ok) { toast(result.error, { tone: 'error' }); return null; }
      const ids = new Set(result.findingIds);
      const risky = rowsRef.current.filter((r) => ids.has(r.findingId) && isRisky(r) && r.decision !== 'pending').length;
      patch(ids, (r) => ({ ...r, ...PENDING }));
      onReviewed(-risky);
      // Rows of a bulk event may not be loaded; the server recounts the summary.
      if (result.findingIds.length > 1) onManyChanged();
      const message = result.row && result.findingIds.length === 1
        ? x.undone(`#${result.row.rowIndex + 1} ${shortName(result.row.productName)}`)
        : count(locale, x.undoneMany, result.findingIds.length);
      toast(message);
      announce(message);
      return result.row?.findingId ?? result.findingIds[0] ?? null;
    } catch (error) {
      toast(failed(error), { tone: 'error' });
      return null;
    }
  }, [announce, failed, locale, onManyChanged, onReviewed, patch, toast, x]);

  /** Puts the server's decision on a row someone else decided, and names who. */
  const adoptServer = useCallback((row: GridRow, conflict: Extract<DecideResult, { code: 'already_decided' }>) => {
    patch(new Set([row.findingId]), (r) => ({
      ...r, decision: conflict.decision, chosenMxik: conflict.chosenMxik,
      chosenName: conflict.chosenMxik === r.suggestedMxik ? r.suggestedName : conflict.chosenMxik === r.currentMxik ? r.currentName : null,
      decisionEventId: conflict.decisionEventId, decisionSource: readDecisionSource(conflict.decisionSource),
    }));
    const when = conflict.decidedAt ? fmtDateTime(locale, conflict.decidedAt) : '';
    toast(conflict.decidedBy ? x.alreadyDecided(conflict.decidedBy, when) : x.alreadyDecidedSystem, { tone: 'error' });
  }, [locale, patch, toast, x]);

  const failureText = useCallback((result: Exclude<DecideResult, { ok: true }>): string => {
    if (result.code === 'sibling_conflict') return x.siblingConflict(result.sibling.chosenMxik);
    if (result.code === 'not_in_classifier') return x.notInClassifier;
    if (result.code === 'no_code') return x.noCode;
    return x.failed;
  }, [x]);

  const apply = useCallback(async (findingId: string, decision: Decision, chosen?: Chosen): Promise<boolean> => {
    const row = rowsRef.current.find((r) => r.findingId === findingId);
    // A decided row is undone first; nothing is overwritten.
    if (!row || row.decision !== 'pending') return false;
    const ids = new Set([findingId]);
    const fallback = row.mode === 'confirm' ? { code: row.currentMxik, name: row.currentName } : { code: row.suggestedMxik, name: row.suggestedName };
    const code = decision === 'accepted' ? (chosen?.code ?? fallback.code) : null;
    const name = decision === 'accepted' ? (chosen ? chosen.name : fallback.name) : null;
    patch(ids, (r) => ({ ...r, decision, chosenMxik: code, chosenName: name, decisionSource: 'manual' }));
    const risky = isRisky(row) ? 1 : 0;
    onReviewed(risky);
    const rollback = (): void => { patch(ids, (r) => ({ ...r, ...PENDING })); onReviewed(-risky); };

    let result: DecideResult;
    try {
      result = await serverChange(api.workspace.decide({ findingId, decision, chosenMxik: chosen?.code ?? null }));
    } catch (error) {
      rollback();
      toast(failed(error), { tone: 'error' });
      return false;
    }
    if (!result.ok) {
      onReviewed(-risky);
      if (result.code === 'already_decided') {
        if (result.decision !== 'pending' && isRisky(row)) onReviewed(1);
        adoptServer(row, result);
      } else {
        patch(ids, (r) => ({ ...r, ...PENDING }));
        toast(failureText(result), { tone: 'error' });
      }
      return false;
    }
    const eventId = result.eventId;
    patch(ids, (r) => ({ ...r, decisionEventId: eventId }));
    const label = `#${row.rowIndex + 1} ${shortName(row.productName)}`;
    const message = decision === 'rejected' ? x.rejected(label) : row.mode === 'confirm' && !chosen ? x.confirmed(label) : x.accepted(label);
    toast(message, { action: { label: ta.wsX.act.undo, run: () => { void revert({ eventId, findingId }); } } });
    announce(message);
    return true;
  }, [adoptServer, announce, failed, failureText, onReviewed, patch, revert, ta, toast, x]);

  /** Applies a many-row result the server already committed. Returns the risky rows changed. */
  const applyMany = useCallback(({ ids, eventId, decision, code, name, source }: ManyApplied): number => {
    const set = new Set(ids);
    const risky = rowsRef.current.filter((r) => set.has(r.findingId) && r.decision === 'pending' && isRisky(r)).length;
    mapRows((r) => {
      if (!set.has(r.findingId) || r.decision !== 'pending') return r;
      const fallback = r.mode === 'confirm' ? { c: r.currentMxik, n: r.currentName } : { c: r.suggestedMxik, n: r.suggestedName };
      return {
        ...r, decision, decisionEventId: eventId, decisionSource: source,
        chosenMxik: decision === 'accepted' ? (code ?? fallback.c) : null,
        chosenName: decision === 'accepted' ? (code ? (name ?? null) : fallback.n) : null,
      };
    });
    onReviewed(risky);
    onManyChanged();
    return risky;
  }, [mapRows, onManyChanged, onReviewed]);

  /** Offers one Undo for a many-row event and reports what was skipped. */
  const reportMany = useCallback((result: { count: number; eventId: string | null; skipped: Parameters<typeof skippedText>[0] }) => {
    const skipped = skippedText(result.skipped, ta, locale);
    if (result.count === 0) { toast([x.nothingChanged, skipped].filter(Boolean).join(' ')); return; }
    const message = [count(locale, x.bulkDone, result.count), skipped].filter(Boolean).join(' ');
    const eventId = result.eventId;
    toast(message, eventId ? { action: { label: ta.wsX.act.undo, run: () => { void revert({ eventId }); } } } : undefined);
    announce(message);
  }, [announce, locale, revert, ta, toast, x]);

  const applyGroup = useCallback(async (group: readonly GridRow[], decision: Decision): Promise<void> => {
    const targets = group.filter((r) => r.decision === 'pending');
    if (targets.length === 0) return;
    try {
      const result = await serverChange(api.workspace.decideGroup({ findingIds: targets.map((r) => r.findingId), decision }));
      if (!result.ok) { toast(result.error, { tone: 'error' }); return; }
      applyMany({ ids: result.ids, eventId: result.eventId, decision, source: 'group' });
      reportMany(result);
    } catch (error) {
      toast(failed(error), { tone: 'error' });
    }
  }, [applyMany, failed, reportMany, toast]);

  /** Keeps the grid's comment count and flag in step with the drawer. */
  const setCommentMeta = useCallback((findingId: string, comments: number, flag: string | null) => {
    patch(new Set([findingId]), (r) => ({ ...r, comments, flag }));
  }, [patch]);

  /** Sets a flag on rows after the server did, with Undo for the bulk event. */
  const flagMany = useCallback((ids: readonly string[], flag: string | null, eventId: string | null) => {
    const before = new Map(rowsRef.current.filter((r) => ids.includes(r.findingId)).map((r) => [r.findingId, r.flag]));
    patch(new Set(ids), (r) => ({ ...r, flag }));
    const message = count(locale, x.flagged, ids.length);
    if (!eventId) { toast(message); return; }
    toast(message, {
      action: {
        label: ta.wsX.act.undo,
        run: () => {
          void serverChange(api.workspace.bulkUndoFlags({ eventId })).then((result) => {
            if (!result.ok) { toast(result.error, { tone: 'error' }); return; }
            patch(new Set(result.findingIds), (r) => ({ ...r, flag: result.flags[r.findingId] ?? before.get(r.findingId) ?? null }));
            toast(count(locale, x.flagsRestored, result.findingIds.length));
          }).catch((error: unknown) => toast(failed(error), { tone: 'error' }));
        },
      },
    });
  }, [failed, locale, patch, ta, toast, x]);

  /** Marks a row as taken out of its group. */
  const ungroup = useCallback((findingId: string) => {
    patch(new Set([findingId]), (r) => ({ ...r, groupKey: null }));
  }, [patch]);

  return { apply, applyGroup, applyMany, reportMany, revert, flagMany, setCommentMeta, ungroup };
}
