// Findings as screens show them: each code with its classifier meaning, and the
// evidence behind the suggestion. One details query for the whole page.
import { evidenceFor, readEvidence, type MatchEvidence } from '@tasnivo/core/match/evidence';
import { groupKeyOf } from '@tasnivo/core/match/group-key';
import { codeDetails, toCodeInfo, type CodeDetail, type CodeInfo } from './code-details.js';
import type { Locale } from '@tasnivo/i18n/i18n';

export type Alternative = {
  code: string;
  name: string;
  confidence: number;
  isBase: boolean;
  info: CodeInfo | null;
  evidence: MatchEvidence | null;
};

export type FindingRow = {
  findingId: string;
  itemId: string;
  rowIndex: number;
  productName: string;
  unit: string | null;
  type: string;
  severity: string;
  reason: string;
  currentMxik: string | null;
  currentInfo: CodeInfo | null;
  suggestedMxik: string | null;
  suggestedInfo: CodeInfo | null;
  chosenInfo: CodeInfo | null;
  confidence: number | null;
  evidence: MatchEvidence | null;
  alternatives: Alternative[];
  decision: 'pending' | 'accepted' | 'rejected';
  chosenMxik: string | null;
  decisionEventId: string | null;
  /** Rows sharing a key are reviewed as one group; null = reviewed alone. */
  groupKey: string | null;
};

export type FindingInput = {
  id: string;
  type: string;
  severity: string;
  reason: string;
  suggestedMxik: string | null;
  confidence: number | null;
  alternatives: unknown;
  evidence: unknown;
  decision: 'pending' | 'accepted' | 'rejected';
  chosenMxik: string | null;
  decisionEventId: string | null;
  groupSplit?: boolean;
  item: { id: string; rowIndex: number; rawName: string; existingMxik: string | null; unit: string | null };
};

type StoredAlternative = { code: string; name: string; confidence: number; isBase: boolean; evidence: MatchEvidence | null };

/** Findings store alternatives as JSON; validate shape before trusting it. */
function readAlternatives(value: unknown): StoredAlternative[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    if (typeof raw !== 'object' || raw === null) return [];
    const r = raw as Record<string, unknown>;
    if (typeof r['code'] !== 'string' || typeof r['name'] !== 'string') return [];
    return [{
      code: r['code'],
      name: r['name'],
      confidence: typeof r['confidence'] === 'number' ? r['confidence'] : 0,
      isBase: r['isBase'] === true,
      evidence: readEvidence(r['evidence']),
    }];
  });
}

/**
 * Older audits stored no evidence. Words and units can still be re-derived
 * from the row and the code; how the code was found (barcode, exact) cannot,
 * so the stage is left unknown rather than guessed.
 */
function derivedEvidence(productName: string, unit: string | null, detail: CodeDetail | undefined): MatchEvidence | null {
  if (!detail) return null;
  return evidenceFor({ stage: 'none', productName, rowUnit: unit, candidate: { ...detail, nameUz: detail.name } });
}

/** Code names follow `locale`; matching evidence is always derived from the Uzbek names it was scored on. */
export async function findingRows(findings: readonly FindingInput[], locale: Locale = 'uz'): Promise<{ rows: FindingRow[]; details: Map<string, CodeDetail> }> {
  const alternatives = new Map(findings.map((f) => [f.id, readAlternatives(f.alternatives)]));
  const codes = findings.flatMap((f) => [
    f.item.existingMxik, f.suggestedMxik, f.chosenMxik,
    ...(alternatives.get(f.id) ?? []).map((a) => a.code),
  ]);
  const [details, uzDetails] = await Promise.all([codeDetails(codes, locale), locale === 'uz' ? null : codeDetails(codes, 'uz')]);
  const scored = uzDetails ?? details;
  const info = (code: string | null): CodeInfo | null => (code ? toCodeInfo(details.get(code)) : null);

  const rows = findings.map((f): FindingRow => ({
    findingId: f.id,
    itemId: f.item.id,
    rowIndex: f.item.rowIndex,
    productName: f.item.rawName,
    unit: f.item.unit,
    type: f.type,
    severity: f.severity,
    reason: f.reason,
    currentMxik: f.item.existingMxik,
    currentInfo: info(f.item.existingMxik),
    suggestedMxik: f.suggestedMxik,
    suggestedInfo: info(f.suggestedMxik),
    chosenInfo: info(f.chosenMxik),
    confidence: f.confidence,
    // UNIT_CONFLICT "suggests" the row's own code; there is nothing to explain.
    evidence: f.type === 'UNIT_CONFLICT' ? null : readEvidence(f.evidence)
      ?? derivedEvidence(f.item.rawName, f.item.unit, f.suggestedMxik ? scored.get(f.suggestedMxik) : undefined),
    alternatives: (alternatives.get(f.id) ?? []).map((a) => ({
      code: a.code,
      name: details.get(a.code)?.name ?? a.name,
      confidence: a.confidence,
      isBase: a.isBase,
      info: info(a.code),
      evidence: a.evidence,
    })),
    decision: f.decision,
    chosenMxik: f.chosenMxik,
    decisionEventId: f.decisionEventId,
    groupKey: groupKeyOf({
      productName: f.item.rawName, type: f.type, suggestedMxik: f.suggestedMxik, split: f.groupSplit === true,
    }),
  }));
  return { rows, details };
}
