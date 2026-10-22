// Grid rows: lean, JSON-safe, with just the names the grid prints.
import { groupKeyOf } from '@tasnivo/core/match/group-key';
import { readEvidence } from '@tasnivo/core/match/evidence';
import type { MatchStage } from '@tasnivo/core/match/types';
import { commentCounts } from './comments';
import { codeDetails, type CodeDetail } from './code-details';
import { db } from '@tasnivo/db';
import { readDecisionSource, type DecisionSource } from './decision-source';
import { decisionMode, noSuggestion, type DecisionMode } from './finding-kinds';
import type { Locale } from '@tasnivo/i18n/i18n';

export type CodeState = 'ok' | 'archived' | 'unknown';

export type GridRow = {
  findingId: string;
  rowIndex: number;
  productName: string;
  unit: string | null;
  type: string;
  severity: string;
  currentMxik: string | null;
  currentName: string | null;
  /** In the classifier now, retired from it, or never in it. */
  currentState: CodeState | null;
  suggestedMxik: string | null;
  suggestedName: string | null;
  confidence: number | null;
  /** Pipeline stage of the suggestion, for its label (barcode and dictionary are identities, not scores). */
  stage: MatchStage | null;
  barcode: boolean;
  /** Suggested from what the firm confirmed before. */
  dictionary: boolean;
  /** A code-suggesting check found nothing acceptable. Never true for checks that do not suggest codes. */
  noSuggestion: boolean;
  /** What accepting this finding means: take the suggestion, pick a code, or confirm the current one. */
  mode: DecisionMode;
  marking: boolean;
  /** ask_client, resolved or null. */
  flag: string | null;
  /** Notes on the row. */
  comments: number;
  decision: 'pending' | 'accepted' | 'rejected';
  decisionSource: DecisionSource | null;
  chosenMxik: string | null;
  chosenName: string | null;
  decisionEventId: string | null;
  groupKey: string | null;
};

export const codeState = (code: string | null, d: CodeDetail | undefined): CodeState | null =>
  !code ? null : !d ? 'unknown' : d.live ? 'ok' : 'archived';

/** Hydrates ids into grid rows, in the order given. Scoped to the org's catalogue. */
export async function gridRows(orgId: string, catalogId: string, ids: readonly string[], locale: Locale = 'uz'): Promise<GridRow[]> {
  if (ids.length === 0) return [];
  const findings = await db.finding.findMany({
    where: { id: { in: [...ids] }, item: { catalogId, catalog: { orgId } } },
    include: { item: { select: { rowIndex: true, rawName: true, existingMxik: true, unit: true, markingRequired: true } } },
  });
  const [details, counts] = await Promise.all([
    codeDetails(findings.flatMap((f) => [f.item.existingMxik, f.suggestedMxik, f.chosenMxik]), locale),
    commentCounts(findings.map((f) => f.id)),
  ]);
  const byId = new Map(findings.map((f) => [f.id, f]));

  return ids.flatMap((id) => {
    const f = byId.get(id);
    if (!f) return [];
    const cur = f.item.existingMxik ? details.get(f.item.existingMxik) : undefined;
    const sug = f.suggestedMxik ? details.get(f.suggestedMxik) : undefined;
    const chosen = f.chosenMxik ? details.get(f.chosenMxik) : undefined;
    const evidence = f.type === 'UNIT_CONFLICT' ? null : readEvidence(f.evidence);
    const kind = { type: f.type, suggestedMxik: f.suggestedMxik, rerankNone: evidence?.rerankNone === true };
    const currentState = codeState(f.item.existingMxik, cur);
    const row: GridRow = {
      findingId: f.id,
      rowIndex: f.item.rowIndex,
      productName: f.item.rawName,
      unit: f.item.unit,
      type: f.type,
      severity: f.severity,
      currentMxik: f.item.existingMxik,
      currentName: cur?.name ?? null,
      currentState,
      suggestedMxik: f.suggestedMxik,
      suggestedName: sug?.name ?? null,
      confidence: f.confidence,
      stage: evidence?.stage ?? null,
      barcode: evidence?.barcode === true,
      dictionary: evidence?.stage === 'dictionary',
      noSuggestion: noSuggestion(kind),
      mode: decisionMode({ ...kind, currentLive: currentState === 'ok' }),
      marking: f.item.markingRequired,
      flag: f.flag,
      comments: counts.get(f.id) ?? 0,
      decision: f.decision,
      decisionSource: readDecisionSource(f.decisionSource),
      chosenMxik: f.chosenMxik,
      chosenName: chosen?.name ?? null,
      decisionEventId: f.decisionEventId,
      groupKey: groupKeyOf({ productName: f.item.rawName, type: f.type, suggestedMxik: f.suggestedMxik, split: f.groupSplit }),
    };
    return [row];
  });
}
