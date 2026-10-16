// Grid rows: lean, JSON-safe, with just the names the grid prints.
import { groupKeyOf } from '../core/match/group-key.js';
import { readEvidence } from '../core/match/evidence.js';
import { commentCounts } from './comments';
import { codeDetails, type CodeDetail } from './code-details';
import { db } from './db';

export type GridRow = {
  findingId: string;
  rowIndex: number;
  productName: string;
  unit: string | null;
  type: string;
  severity: string;
  currentMxik: string | null;
  currentName: string | null;
  /** Code is in the snapshot but retired, or missing from it. */
  currentState: 'ok' | 'archived' | 'unknown' | null;
  suggestedMxik: string | null;
  suggestedName: string | null;
  confidence: number | null;
  barcode: boolean;
  /** Suggested from what the firm confirmed before. */
  dictionary: boolean;
  /** No acceptable suggestion: nothing found, or the reranker said none. */
  noSuggestion: boolean;
  marking: boolean;
  /** ask_client, resolved or null. */
  flag: string | null;
  /** Notes on the row. */
  comments: number;
  decision: 'pending' | 'accepted' | 'rejected';
  chosenMxik: string | null;
  chosenName: string | null;
  decisionEventId: string | null;
  groupKey: string | null;
};

const stateOf = (code: string | null, d: CodeDetail | undefined): GridRow['currentState'] =>
  !code ? null : !d ? 'unknown' : d.live ? 'ok' : 'archived';

/** Hydrates ids into grid rows, in the order given. Scoped to the org's catalogue. */
export async function gridRows(orgId: string, catalogId: string, ids: readonly string[]): Promise<GridRow[]> {
  if (ids.length === 0) return [];
  const findings = await db.finding.findMany({
    where: { id: { in: [...ids] }, item: { catalogId, catalog: { orgId } } },
    include: { item: { select: { rowIndex: true, rawName: true, existingMxik: true, unit: true, markingRequired: true } } },
  });
  const details = await codeDetails(findings.flatMap((f) => [f.item.existingMxik, f.suggestedMxik, f.chosenMxik]));
  const byId = new Map(findings.map((f) => [f.id, f]));
  const counts = await commentCounts(findings.map((f) => f.id));

  return ids.flatMap((id) => {
    const f = byId.get(id);
    if (!f) return [];
    const cur = f.item.existingMxik ? details.get(f.item.existingMxik) : undefined;
    const sug = f.suggestedMxik ? details.get(f.suggestedMxik) : undefined;
    const chosen = f.chosenMxik ? details.get(f.chosenMxik) : undefined;
    const evidence = readEvidence(f.evidence);
    const row: GridRow = {
      findingId: f.id,
      rowIndex: f.item.rowIndex,
      productName: f.item.rawName,
      unit: f.item.unit,
      type: f.type,
      severity: f.severity,
      currentMxik: f.item.existingMxik,
      currentName: cur?.name ?? null,
      currentState: stateOf(f.item.existingMxik, cur),
      suggestedMxik: f.suggestedMxik,
      suggestedName: sug?.name ?? null,
      confidence: f.confidence,
      barcode: evidence?.barcode === true,
      dictionary: evidence?.stage === 'dictionary',
      noSuggestion: !f.suggestedMxik || evidence?.rerankNone === true,
      marking: f.item.markingRequired,
      flag: f.flag,
      comments: counts.get(f.id) ?? 0,
      decision: f.decision,
      chosenMxik: f.chosenMxik,
      chosenName: chosen?.name ?? null,
      decisionEventId: f.decisionEventId,
      groupKey: groupKeyOf({ productName: f.item.rawName, type: f.type, suggestedMxik: f.suggestedMxik, split: f.groupSplit }),
    };
    return [row];
  });
}
