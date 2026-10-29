// Everything the row drawer shows for one finding, scoped to the org and the
// user's clients, with code names in the viewer's language.
import { readEvidence } from '@tasnivo/core/match/evidence';
import type { MatchStage } from '@tasnivo/core/match/types';
import { codeDetails, localName, readableLevel } from './code-details';
import { catalogScope } from './access';
import { nameFromBarcode, type NameFromBarcode } from './barcode-name';
import { db } from '@tasnivo/db';
import { readDecisionSource, type DecisionSource } from './decision-source';
import { decisionMode, noSuggestion, type DecisionMode } from './finding-kinds';
import { findingRows } from './finding-view';
import { memberEmails } from './member-emails';
import type { Locale } from '@tasnivo/i18n/i18n';
import type { AppDict } from '@tasnivo/i18n/i18n-app';
import { cleanPrivilegeName, LEVEL_SPLITS, levelPrefixes, rankAlternatives, reasonFacts, type ReasonFacts } from './row-detail-parts';
import { rowSignals, type Signal } from './row-signals';
import { unitAdvice, type UnitAdvice } from './unit-advice';
import { containerLabel, packagingLabel, unitLabel } from './unit-label';
import type { CodeState } from './workspace-rows';

export type { ReasonFacts } from './row-detail-parts';

/** One level of a code; `missing` when no classifier code has this prefix (a code that is not there). */
export type CodeBlock = { digits: string; name: string | null; missing: boolean };
export type CodeView = { code: string; name: string; state: CodeState; blocks: CodeBlock[] };

export type RowDetail = {
  findingId: string;
  productName: string;
  unit: string | null;
  barcode: string | null;
  type: string;
  severity: string;
  /** The check's own explanation, as the audit stored it (Uzbek). The drawer explains from `facts`. */
  reason: string;
  facts: ReasonFacts;
  confidence: number | null;
  stage: MatchStage | null;
  current: CodeView | null;
  suggested: CodeView | null;
  chosen: CodeView | null;
  /** PRIVILEGE_OPPORTUNITY: the privileged code the row's suggestion points at. */
  opportunity: CodeView | null;
  signals: Signal[];
  alternatives: { code: string; name: string; path: string; confidence: number }[];
  markingCurrent: boolean;
  markingSuggested: boolean;
  privileges: string[];
  noSuggestion: boolean;
  mode: DecisionMode;
  nameOffer: NameFromBarcode | null;
  advice: UnitAdvice;
  /** The units, packaging values and container of `facts` and `advice` in the reader's language, keyed by the value as sent. */
  labels: UnitLabels;
  decision: 'pending' | 'accepted' | 'rejected';
  decisionEventId: string | null;
  decisionSource: DecisionSource | null;
  /** Email of the person who decided; null for the system or an account since removed. */
  decidedBy: string | null;
  decidedAt: string | null;
};

export type UnitLabels = { units: Record<string, string>; packaging: Record<string, string>; containers: Record<string, string> };

/** The drawer's unit words in the reader's language (the classifier's unit table is Uzbek). */
export function unitLabels(locale: Locale, facts: Pick<ReasonFacts, 'requiredUnits'>, advice: UnitAdvice): UnitLabels {
  const units = [...facts.requiredUnits, ...(advice.unit ? [advice.unit.suggested] : [])];
  const container = advice.packaging?.codeContainer ?? null;
  return {
    units: Object.fromEntries(units.map((u) => [u, unitLabel(locale, u)])),
    packaging: Object.fromEntries((advice.packaging?.values ?? []).map((v) => [v, packagingLabel(locale, v)])),
    containers: container ? { [container]: containerLabel(locale, container) } : {},
  };
}

type LevelRow = {
  groupNameUz: string | null; classNameUz: string | null; positionNameUz: string | null; subPositionNameUz: string | null; nameUz: string;
  groupNameRu: string | null; classNameRu: string | null; positionNameRu: string | null; subPositionNameRu: string | null; nameRu: string;
  retiredAt: Date | null;
};

const LEVEL_SELECT = {
  groupNameUz: true, classNameUz: true, positionNameUz: true, subPositionNameUz: true, nameUz: true,
  groupNameRu: true, classNameRu: true, positionNameRu: true, subPositionNameRu: true, nameRu: true,
  retiredAt: true,
} as const;

/** Level names of a code, group to brand/attribute; null where the level has no name. */
function levelNames(names: LevelRow, locale: Locale): (string | null)[] {
  return [
    localName(locale, names.groupNameUz, names.groupNameRu), localName(locale, names.classNameUz, names.classNameRu),
    localName(locale, names.positionNameUz, names.positionNameRu), localName(locale, names.subPositionNameUz, names.subPositionNameRu),
    localName(locale, names.nameUz, names.nameRu),
  ];
}

type Known = { levels: (string | null)[]; exists: boolean[] };

/**
 * Levels of a code the classifier does not have, looked up one by one through
 * any code sharing that prefix. A level no code has is missing: from there on
 * the code is wrong. The full code itself is missing by definition.
 */
async function partialLevels(code: string, locale: Locale): Promise<Known> {
  const prefixes = levelPrefixes(code).slice(0, LEVEL_SPLITS.length - 1);
  const rows = await Promise.all(prefixes.map((prefix) => db.mxikCode.findFirst({ where: { code: { startsWith: prefix } }, select: LEVEL_SELECT })));
  return {
    levels: [...rows.map((row, i) => (row ? levelNames(row, locale)[i] ?? null : null)), null],
    exists: [...rows.map((row) => row !== null), false],
  };
}

function toView(code: string, names: LevelRow | undefined, partial: Known | undefined, locale: Locale): CodeView {
  const levels = names ? levelNames(names, locale) : partial?.levels ?? [null, null, null, null, null];
  let from = 0;
  const blocks = LEVEL_SPLITS.map((to, i): CodeBlock => {
    const digits = code.slice(from, to);
    from = to;
    const raw = levels[i];
    return { digits, name: raw ? readableLevel(raw) : null, missing: !names && partial !== undefined && partial.exists[i] !== true };
  });
  const state: CodeState = !names ? 'unknown' : names.retiredAt === null ? 'ok' : 'archived';
  return { code, name: names ? localName(locale, names.nameUz, names.nameRu) ?? '' : '', state, blocks };
}

const SUGGESTING = ['MISSING', 'NOT_FOUND', 'MISMATCH'] as const;

/** The privileged code a PRIVILEGE_OPPORTUNITY finding is about: its row's code suggestion. */
async function opportunityCode(itemId: string, reason: string): Promise<string | null> {
  const siblings = await db.finding.findMany({
    where: { itemId, type: { in: [...SUGGESTING] }, suggestedMxik: { not: null } },
    select: { suggestedMxik: true },
  });
  const codes = siblings.flatMap((s) => (s.suggestedMxik ? [s.suggestedMxik] : []));
  // Several suggestions on one row: the one the finding names.
  return codes.find((c) => reason.includes(c)) ?? codes[0] ?? null;
}

export async function rowDetail(
  scope: { orgId: string; clientIds?: string[] | null }, findingId: string, ta: AppDict, locale: Locale = 'uz',
): Promise<RowDetail | null> {
  const f = await db.finding.findFirst({
    where: { id: findingId, item: { catalog: catalogScope(scope) } },
    include: { item: { select: { id: true, rowIndex: true, rawName: true, existingMxik: true, unit: true, barcode: true } } },
  });
  if (!f) return null;
  const { rows } = await findingRows([f], locale);
  const row = rows[0];
  if (!row) return null;

  const best = f.suggestedMxik && f.confidence !== null ? { code: f.suggestedMxik, confidence: f.confidence } : null;
  const alts = rankAlternatives(best, row.alternatives.filter((a) => a.code !== f.suggestedMxik)).slice(0, 5);
  const opportunity = f.type === 'PRIVILEGE_OPPORTUNITY' ? await opportunityCode(f.item.id, f.reason) : null;
  const codes = [...new Set([f.item.existingMxik, f.suggestedMxik, f.chosenMxik, opportunity, ...alts.map((a) => a.code)].filter((c): c is string => Boolean(c)))];
  const [levels, details, decider] = await Promise.all([
    db.mxikCode.findMany({ where: { code: { in: codes } }, select: { code: true, unitBinding: true, unitCanonical: true, unitContainer: true, ...LEVEL_SELECT } }),
    codeDetails(codes, locale),
    // A member removed since still shows, by the address their removal event kept.
    memberEmails(scope.orgId, [f.decidedBy]),
  ]);
  const names = new Map(levels.map((l) => [l.code.trim(), l]));
  // A code the classifier lacks still shows which of its levels exist.
  const missing = codes.filter((c) => !names.has(c) && /^\d{17}$/.test(c) && (c === f.item.existingMxik || c === f.chosenMxik));
  const partial = new Map(await Promise.all(missing.map(async (c): Promise<[string, Known]> => [c, await partialLevels(c, locale)])));
  const view = (code: string | null): CodeView | null => (code ? toView(code, names.get(code), partial.get(code), locale) : null);

  const privileged = [f.item.existingMxik, f.suggestedMxik, opportunity];
  const ids = [...new Set(privileged.flatMap((c) => (c ? details.get(c)?.taxPrivilegeIds ?? [] : [])))];
  const privileges = ids.length === 0 ? [] : (await db.taxPrivilege.findMany({ where: { id: { in: ids } }, select: { id: true, nameLatn: true, nameRu: true } }))
    .map((p) => cleanPrivilegeName(localName(locale, p.nameLatn, p.nameRu) ?? p.id));

  const evidence = f.type === 'UNIT_CONFLICT' ? null : readEvidence(f.evidence) ?? row.evidence;
  const kind = { type: f.type, suggestedMxik: f.suggestedMxik, rerankNone: evidence?.rerankNone === true };
  const current = view(f.item.existingMxik);
  const own = f.item.existingMxik ? names.get(f.item.existingMxik) ?? null : null;
  const facts = reasonFacts({
    type: f.type, severity: f.severity, reason: f.reason, wasRetired: f.wasRetired, snapshotId: f.snapshotId,
    existingMxik: f.item.existingMxik, unit: f.item.unit, codeUnits: own?.unitCanonical ?? [],
    restrictedMxik: f.restrictedMxik, restrictedFrom: f.restrictedFrom,
  });
  const advice = unitAdvice({ rawName: f.item.rawName, rowUnit: f.item.unit, code: own });
  return {
    findingId: f.id,
    productName: f.item.rawName,
    unit: f.item.unit,
    barcode: f.item.barcode,
    type: f.type,
    severity: f.severity,
    reason: f.reason,
    facts,
    confidence: f.confidence,
    stage: evidence?.stage ?? null,
    current,
    suggested: view(f.suggestedMxik),
    chosen: f.chosenMxik && f.chosenMxik !== f.suggestedMxik ? view(f.chosenMxik) : null,
    opportunity: view(opportunity),
    signals: rowSignals({ evidence, confidence: f.confidence, rowUnit: f.item.unit, codeUnit: row.suggestedInfo?.unit ?? null }, ta),
    alternatives: alts.map((a) => ({ code: a.code, name: a.name, path: a.info?.shortPath ?? '', confidence: a.confidence })),
    markingCurrent: row.currentInfo?.isMarked === true,
    markingSuggested: row.suggestedInfo?.isMarked === true,
    privileges,
    noSuggestion: noSuggestion(kind),
    mode: decisionMode({ ...kind, currentLive: current?.state === 'ok' }),
    nameOffer: await nameFromBarcode(f.item),
    advice,
    labels: unitLabels(locale, facts, advice),
    decision: f.decision,
    decisionEventId: f.decisionEventId,
    decisionSource: readDecisionSource(f.decisionSource),
    decidedBy: f.decidedBy ? decider.get(f.decidedBy) ?? null : null,
    decidedAt: f.decidedAt?.toISOString() ?? null,
  };
}
