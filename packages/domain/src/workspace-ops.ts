// The review workspace's operations as both the web's server actions and the API run them: the
// caller has signed the user in and shaped the input; access is checked here or in the services
// below; error texts come back in the user's language, exactly as the actions returned them.
import { i18nFor } from '@tasnivo/i18n/locale';
import type { Locale } from '@tasnivo/i18n/i18n';
import { db } from '@tasnivo/db';
import { catalogScope } from './access.js';
import { addComment, listComments, type CommentView } from './comments.js';
import { bulkApply, bulkPreview, undoFlags, type BulkAction, type BulkPreview, type BulkTarget, type FlagUndo } from './bulk.js';
import type { ManyDone } from './decide-many.js';
import {
  bulkAccept, recordDecision, recordGroupDecision, reopenDecision, splitFromGroup, sureBandPreview, undoDecision, undoLast,
  type Actor, type DecideOutcome, type SurePreview, type UndoDone,
} from './decisions.js';
import type { ViewParams } from './view-params.js';
import { listViews, removeView, saveView, setDefaultView, type ViewRow } from './views.js';
import { decodeCursor, workspaceChipCounts, workspaceCount, workspacePageIds, type ChipCounts } from './workspace.js';
import { readFilter, type FilterParams, type WsFilter } from './workspace-filter.js';
import { gridRows, type GridRow } from './workspace-rows.js';

/** Grid rows per page, the first page included (page.tsx FIRST_PAGE, actions/workspace.ts PAGE). */
export const ROWS_PAGE = 120;

type Viewer = { orgId: string; clientIds?: string[] | null };

/** The catalogue's id when this user may see it. */
export async function visibleCatalogId(user: Viewer, catalogId: string): Promise<string | null> {
  const catalog = await db.catalog.findFirst({ where: { id: catalogId, ...catalogScope(user) }, select: { id: true } });
  return catalog?.id ?? null;
}

export type RowsPage = { rows: GridRow[]; next: string | null };

/**
 * One page of grid rows for a filter; null when the catalogue is not the user's. The first page
 * (empty cursor) may lead with a linked finding that is not on it (`focusRow`, the queue's `?row=`
 * link), as the workspace page does; gridRows keeps it to this catalogue.
 */
export async function rowsPage(
  user: Viewer, catalogId: string, filter: FilterParams, cursor: string, locale: Locale, focusRow: string | null = null,
): Promise<RowsPage | null> {
  const id = await visibleCatalogId(user, catalogId);
  if (!id) return null;
  const { ids, next } = await workspacePageIds(id, readFilter(filter), decodeCursor(cursor), ROWS_PAGE);
  const wanted = !cursor && focusRow && focusRow.length <= 64 && !ids.includes(focusRow) ? [focusRow, ...ids] : ids;
  return { rows: await gridRows(user.orgId, id, wanted, locale), next };
}

/** Rows matching a filter and the chip counts by type; null when the catalogue is not the user's. */
export async function rowsCounts(user: Viewer, catalogId: string, filter: WsFilter): Promise<{ count: number; chips: ChipCounts } | null> {
  const id = await visibleCatalogId(user, catalogId);
  if (!id) return null;
  const [count, chips] = await Promise.all([workspaceCount(id, filter), workspaceChipCounts(id, filter)]);
  return { count, chips };
}

export type DecideResult = { ok: true; eventId: string } | Extract<DecideOutcome, { ok: false }>;

/** One accept or reject; conflicts come back typed, with the generic error text. */
export async function decideFinding(
  user: Actor, input: { findingId: string; decision: 'accepted' | 'rejected'; chosenMxik?: string | null | undefined }, locale: Locale,
): Promise<DecideResult> {
  const result = await recordDecision(user, input);
  return result.ok ? result : { ...result, error: i18nFor(locale).t.errorGeneric };
}

export type ManyOutcome = ({ ok: true } & ManyDone) | { ok: false; error: string };

const many = (result: ({ ok: true } & ManyDone) | { ok: false; error: string }, locale: Locale): ManyOutcome =>
  (result.ok ? result : { ok: false, error: i18nFor(locale).t.errorGeneric });

/** One decision for a group of similar rows: one event, one undo. */
export async function decideGroup(user: Actor, input: { findingIds: string[]; decision: 'accepted' | 'rejected' }, locale: Locale): Promise<ManyOutcome> {
  return many(await recordGroupDecision(user, input), locale);
}

/** Takes a row out of its group. */
export async function splitRow(user: Actor, findingId: string): Promise<{ ok: boolean }> {
  return { ok: (await splitFromGroup(user, findingId)).ok };
}

/** "Accept all high-match" in the catalogue (null filter) or the current filter. */
export async function acceptSure(
  user: Actor, input: { catalogId: string; minConfidence: number; filter?: FilterParams | null | undefined }, locale: Locale,
): Promise<ManyOutcome> {
  const { catalogId, minConfidence, filter } = input;
  return many(await bulkAccept(user, { catalogId, minConfidence, filter: filter ? readFilter(filter) : null }), locale);
}

export type SurePreviewResult = ({ ok: true } & SurePreview) | { ok: false; error: string };

/** Counts for the confirmation before accepting the sure band. */
export async function previewSure(user: Actor, catalogId: string, filter: FilterParams | null | undefined, locale: Locale): Promise<SurePreviewResult> {
  const result = await sureBandPreview(user, catalogId, filter ? readFilter(filter) : null);
  return result.ok ? result : { ok: false, error: i18nFor(locale).t.errorGeneric };
}

export type UndoInput = { eventId: string; findingId?: string | undefined } | { lastInCatalog: string } | { reopen: string };
export type UndoResult = ({ ok: true } & UndoDone) | { ok: false; error: string };

/** Undo an event (or one row of it), the user's latest own decision in a catalogue, or reopen one row. */
export async function undoReview(user: Actor, input: UndoInput, locale: Locale): Promise<UndoResult> {
  const result = 'eventId' in input ? await undoDecision(user, input.eventId, input.findingId)
    : 'reopen' in input ? await reopenDecision(user, input.reopen)
      : await undoLast(user, input.lastInCatalog);
  if (result.ok) return result;
  const { t, ta } = i18nFor(locale);
  return { ok: false, error: result.error === 'nothing to undo' ? ta.wsX.undo.nothing : t.reviewUndoFailed };
}

/** What the browser sends as a bulk target: ids, or a filter as URL-shaped strings. */
export type BulkTargetInput = { ids: string[] } | { filter: FilterParams };

const toTarget = (t: BulkTargetInput): BulkTarget => ('ids' in t ? t : { filter: readFilter(t.filter) });

/** Applies one action to the selected rows, or every row of a filter (up to the cap). */
export async function applyBulk(user: Actor, catalogId: string, target: BulkTargetInput, action: BulkAction, locale: Locale): Promise<ManyOutcome> {
  const result = await bulkApply(user, catalogId, toTarget(target), action);
  if (result.ok) return result;
  const { t, ta } = i18nFor(locale);
  return { ok: false, error: result.error === 'code not in classifier' ? ta.msg.codeNotInClassifier : t.errorGeneric };
}

export type DryRunResult = ({ ok: true } & BulkPreview) | { ok: false; error: string };

/** How many rows a bulk action would touch. */
export async function previewBulk(user: Actor, catalogId: string, target: BulkTargetInput, action: BulkAction, locale: Locale): Promise<DryRunResult> {
  const result = await bulkPreview(user, catalogId, toTarget(target), action);
  return result.ok ? result : { ok: false, error: i18nFor(locale).t.errorGeneric };
}

export type FlagUndoResult = ({ ok: true } & FlagUndo) | { ok: false; error: string };

/** Puts back the flags one bulk flag action replaced. */
export async function undoBulkFlags(user: Actor, eventId: string, locale: Locale): Promise<FlagUndoResult> {
  const result = await undoFlags(user, eventId);
  return result.ok ? result : { ok: false, error: i18nFor(locale).t.reviewUndoFailed };
}

/** Adds a note and answers the thread; null when the note was not added (viewer, row out of reach). */
export async function postCommentFor(user: Actor, findingId: string, body: string): Promise<CommentView[] | null> {
  if (!(await addComment(user, findingId, body))) return null;
  return listComments(user, findingId);
}

export type ViewsResult = { ok: true; views: ViewRow[] } | { ok: false; views: ViewRow[] };

const withViews = async (user: Actor, ok: boolean): Promise<ViewsResult> => {
  const views = await listViews(user);
  return ok ? { ok: true, views } : { ok: false, views };
};

/** Saves a view and answers the list; a demo session saves nothing. */
export async function saveViewFor(user: Actor & { demo?: boolean }, input: { name: string; params: ViewParams; makeDefault: boolean }): Promise<ViewsResult> {
  const ok = user.demo ? false : await saveView(user, input.name, input.params, input.makeDefault);
  return withViews(user, ok);
}

export async function removeViewFor(user: Actor, viewId: string): Promise<ViewsResult> {
  const ok = await removeView(user, viewId);
  return withViews(user, ok);
}

/** Chooses the default view (null: none) and answers the list. */
export async function setDefaultViewFor(user: Actor, viewId: string | null): Promise<ViewsResult> {
  const ok = await setDefaultView(user, viewId);
  return withViews(user, ok);
}
