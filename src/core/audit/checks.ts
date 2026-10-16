// The five checks, as pure functions over an already-resolved row.
//
// ARCHIVED is not a separate type: no source exposes deprecation status
// (docs/gate0-report.md §3) and the remedy is identical to NOT_FOUND, so a
// retired code reports as NOT_FOUND with `wasRetired` set. Once snapshot history
// accumulates, flipping it into its own type is an enum addition and one branch.
import { unitsCompatible } from '../normalize/units.js';
import type { MatchEvidence } from '../match/evidence.js';
import type { MxikCandidate, ScoredCandidate } from '../match/types.js';

export type FindingType = 'MISSING' | 'NOT_FOUND' | 'MISMATCH' | 'UNIT_CONFLICT' | 'NOT_PURCHASED'
  | 'PRIVILEGE_CODE' | 'PRIVILEGE_OPPORTUNITY';
/** "info" findings are shown but never counted as risk. */
export type Severity = 'high' | 'medium' | 'info';

/** Below this, a present-and-valid code is treated as not matching the name. */
export const MISMATCH_THRESHOLD = 0.6;

/**
 * Codes sharing the first 8 digits sit in the same position of the
 * classifier (e.g. a base code and a brand's identifying code under it).
 * Approved 2026-10-15 on demo:quality evidence: without the reranker a short
 * shop name scores low against its own generic base code, and flagging that as
 * a mismatch was wrong two times in three.
 */
const POSITION_DIGITS = 8;

export type ResolvedRow = {
  /** The row's own code, exactly as the catalogue had it (may be junk). */
  existingMxik: string | null;
  unit: string | null;
  /** What the classifier says about `existingMxik`. */
  existing: {
    found: boolean;
    /** Present in an earlier import but absent from the current one. */
    retired: boolean;
    candidate: MxikCandidate | null;
  };
  /** Ranked suggestions from the matching pipeline, best first. */
  suggestions: readonly ScoredCandidate[];
};

export type Finding = {
  type: FindingType;
  severity: Severity;
  suggestedMxik: string | null;
  confidence: number | null;
  alternatives: {
    code: string;
    name: string;
    confidence: number;
    reason: string;
    isBase: boolean;
    evidence: MatchEvidence;
  }[];
  reason: string;
  wasRetired: boolean;
  /** Why the suggested code was proposed; null when nothing was suggested. */
  evidence: MatchEvidence | null;
};

/** Normalizes whatever the spreadsheet had into a code or nothing. */
export function readCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  return digits.length === 0 ? null : digits;
}

function alternativesOf(suggestions: readonly ScoredCandidate[]): Finding['alternatives'] {
  return suggestions.slice(0, 4).map((s) => ({
    code: s.candidate.code,
    name: s.candidate.nameUz,
    confidence: s.confidence,
    reason: s.reason,
    isBase: s.candidate.isBase,
    evidence: s.evidence,
  }));
}

/**
 * Runs every applicable check. A row can produce more than one finding: a valid
 * code can simultaneously be a poor name match and carry the wrong unit.
 * MISSING and NOT_FOUND are mutually exclusive, and the two medium checks only
 * apply once the code is known to be valid.
 */
export function runChecks(row: ResolvedRow): Finding[] {
  const findings: Finding[] = [];
  const best = row.suggestions[0];
  const code = readCode(row.existingMxik);

  // ---------------------------------------------------------------- MISSING
  if (code === null) {
    findings.push({
      type: 'MISSING',
      severity: 'high',
      suggestedMxik: best?.candidate.code ?? null,
      confidence: best?.confidence ?? null,
      alternatives: alternativesOf(row.suggestions),
      reason: best
        ? `Qatorda MXIK kodi yoʻq. Taklif: ${best.candidate.code}.`
        : 'Qatorda MXIK kodi yoʻq va mos kod topilmadi.',
      wasRetired: false,
      evidence: best?.evidence ?? null,
    });
    return findings;
  }

  // ---------------------------------------------------------------- NOT_FOUND
  if (!row.existing.found || row.existing.retired) {
    findings.push({
      type: 'NOT_FOUND',
      severity: 'high',
      suggestedMxik: best?.candidate.code ?? null,
      confidence: best?.confidence ?? null,
      alternatives: alternativesOf(row.suggestions),
      reason: row.existing.retired
        ? `${code} kodi klassifikatorning joriy versiyasida yoʻq (avvalgi versiyada mavjud edi).`
        : `${code} kodi klassifikatorda topilmadi.`,
      wasRetired: row.existing.retired,
      evidence: best?.evidence ?? null,
    });
    return findings;
  }

  const existing = row.existing.candidate;

  // ---------------------------------------------------------------- MISMATCH
  // How well does the row's own code score against the row's own name? If the
  // pipeline ranked it at all, use that; if it never surfaced, that is itself
  // the signal.
  const selfScore = row.suggestions.find((s) => s.candidate.code === code)?.confidence ?? 0;
  // A low self-score alone is not evidence: only flag when the best suggestion
  // lies in a different position of the classifier than the row's own code.
  const samePosition = best !== undefined
    && best.candidate.code.slice(0, POSITION_DIGITS) === code.slice(0, POSITION_DIGITS);
  if (selfScore < MISMATCH_THRESHOLD && !samePosition) {
    findings.push({
      type: 'MISMATCH',
      severity: 'medium',
      suggestedMxik: best?.candidate.code ?? null,
      confidence: best?.confidence ?? null,
      alternatives: alternativesOf(row.suggestions),
      reason: best && best.candidate.code !== code
        ? `${code} kodi tovar nomiga mos kelmaydi. Taklif: ${best.candidate.code}.`
        : `${code} kodi tovar nomiga mos kelmaydi.`,
      wasRetired: false,
      evidence: best?.evidence ?? null,
    });
  }

  // ------------------------------------------------------------ UNIT_CONFLICT
  // Only a strict binding can conflict; recommended units never produce findings.
  if (existing && existing.unitBinding === 'strict'
      && !unitsCompatible(row.unit, existing.unitCanonical)) {
    findings.push({
      type: 'UNIT_CONFLICT',
      severity: 'medium',
      // The code is fine here — the unit is what needs fixing.
      suggestedMxik: code,
      confidence: null,
      alternatives: [],
      reason: `Oʻlchov birligi notoʻgʻri: qatorda "${row.unit ?? ''}", kod talab qiladi "${existing.unitCanonical.join(' / ')}".`,
      wasRetired: false,
      evidence: null,
    });
  }

  return findings;
}

export type Summary = {
  totalRows: number;
  riskyRows: number;
  byType: Record<FindingType, number>;
};

/** The Report screen's headline block. Counts rows at risk, not findings. */
export function summarize(perRow: readonly Finding[][], totalRows: number): Summary {
  const byType: Record<FindingType, number> = {
    MISSING: 0, NOT_FOUND: 0, MISMATCH: 0, UNIT_CONFLICT: 0, NOT_PURCHASED: 0,
    PRIVILEGE_CODE: 0, PRIVILEGE_OPPORTUNITY: 0,
  };
  let riskyRows = 0;
  for (const findings of perRow) {
    if (findings.some((f) => f.severity !== 'info')) riskyRows++;
    for (const f of findings) byType[f.type]++;
  }
  return { totalRows, riskyRows, byType };
}
