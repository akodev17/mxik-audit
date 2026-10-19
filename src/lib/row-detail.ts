// Everything the row drawer shows for one finding, scoped to the org and the
// user's clients, with code names in the viewer's language.
import { readEvidence } from '../core/match/evidence.js';
import type { MatchStage } from '../core/match/types.js';
import { codeDetails, localName, readableLevel } from './code-details';
import { catalogScope } from './access';
import { nameFromBarcode, type NameFromBarcode } from './barcode-name';
import { db } from './db';
import { readDecisionSource, type DecisionSource } from './decision-source';
import { decisionMode, noSuggestion, type DecisionMode } from './finding-kinds';
import { findingRows } from './finding-view';
import type { Locale } from './i18n';
import type { AppDict } from './i18n-app';
import { rowSignals, type Signal } from './row-signals';
import { unitAdvice, type UnitAdvice } from './unit-advice';
import type { CodeState } from './workspace-rows';

export type CodeBlock = { digits: string; name: string | null };
export type CodeView = { code: string; name: string; state: CodeState; blocks: CodeBlock[] };

export type RowDetail = {
  findingId: string;
  productName: string;
  unit: string | null;
  barcode: string | null;
  type: string;
  severity: string;
  /** The check's own explanation, as the audit wrote it. */
  reason: string;
  confidence: number | null;
  stage: MatchStage | null;
  current: CodeView | null;
  suggested: CodeView | null;
  chosen: CodeView | null;
  signals: Signal[];
  alternatives: { code: string; name: string; path: string; confidence: number }[];
  markingCurrent: boolean;
  markingSuggested: boolean;
  privileges: string[];
  noSuggestion: boolean;
  mode: DecisionMode;
  nameOffer: NameFromBarcode | null;
  advice: UnitAdvice;
  decision: 'pending' | 'accepted' | 'rejected';
  decisionEventId: string | null;
  decisionSource: DecisionSource | null;
  /** Email of the person who decided; null for the system or an account since removed. */
  decidedBy: string | null;
  decidedAt: string | null;
};

/** Split points of the 17-digit code: guruh, sinf, pozitsiya, subpozitsiya, brend/atribut. */
const SPLITS = [3, 5, 8, 11, 17] as const;

type LevelRow = {
  groupNameUz: string | null; classNameUz: string | null; positionNameUz: string | null; subPositionNameUz: string | null; nameUz: string;
  groupNameRu: string | null; classNameRu: string | null; positionNameRu: string | null; subPositionNameRu: string | null; nameRu: string;
  retiredAt: Date | null;
};

function toView(code: string, names: LevelRow | undefined, locale: Locale): CodeView {
  const levels = names
    ? [
      localName(locale, names.groupNameUz, names.groupNameRu), localName(locale, names.classNameUz, names.classNameRu),
      localName(locale, names.positionNameUz, names.positionNameRu), localName(locale, names.subPositionNameUz, names.subPositionNameRu),
      localName(locale, names.nameUz, names.nameRu),
    ]
    : [null, null, null, null, null];
  let from = 0;
  const blocks = SPLITS.map((to, i): CodeBlock => {
    const digits = code.slice(from, to);
    from = to;
    const raw = levels[i];
    return { digits, name: raw ? readableLevel(raw) : null };
  });
  const state: CodeState = !names ? 'unknown' : names.retiredAt === null ? 'ok' : 'archived';
  return { code, name: names ? localName(locale, names.nameUz, names.nameRu) ?? '' : '', state, blocks };
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

  const alts = row.alternatives.filter((a) => a.code !== f.suggestedMxik).slice(0, 5);
  const codes = [...new Set([f.item.existingMxik, f.suggestedMxik, f.chosenMxik, ...alts.map((a) => a.code)].filter((c): c is string => Boolean(c)))];
  const [levels, details, decider] = await Promise.all([
    db.mxikCode.findMany({
      where: { code: { in: codes } },
      select: {
        code: true, unitBinding: true, unitCanonical: true, unitContainer: true, retiredAt: true,
        groupNameUz: true, classNameUz: true, positionNameUz: true, subPositionNameUz: true, nameUz: true,
        groupNameRu: true, classNameRu: true, positionNameRu: true, subPositionNameRu: true, nameRu: true,
      },
    }),
    codeDetails(codes, locale),
    f.decidedBy ? db.user.findFirst({ where: { id: f.decidedBy, orgId: scope.orgId }, select: { email: true } }) : null,
  ]);
  const names = new Map(levels.map((l) => [l.code.trim(), l]));
  const view = (code: string | null): CodeView | null => (code ? toView(code, names.get(code), locale) : null);

  const ids = [...new Set([f.item.existingMxik, f.suggestedMxik].flatMap((c) => (c ? details.get(c)?.taxPrivilegeIds ?? [] : [])))];
  const privileges = ids.length === 0 ? [] : (await db.taxPrivilege.findMany({ where: { id: { in: ids } }, select: { id: true, nameLatn: true, nameRu: true } }))
    .map((p) => localName(locale, p.nameLatn, p.nameRu) ?? p.id);

  const evidence = f.type === 'UNIT_CONFLICT' ? null : readEvidence(f.evidence) ?? row.evidence;
  const kind = { type: f.type, suggestedMxik: f.suggestedMxik, rerankNone: evidence?.rerankNone === true };
  const current = view(f.item.existingMxik);
  return {
    findingId: f.id,
    productName: f.item.rawName,
    unit: f.item.unit,
    barcode: f.item.barcode,
    type: f.type,
    severity: f.severity,
    reason: f.reason,
    confidence: f.confidence,
    stage: evidence?.stage ?? null,
    current,
    suggested: view(f.suggestedMxik),
    chosen: f.chosenMxik && f.chosenMxik !== f.suggestedMxik ? view(f.chosenMxik) : null,
    signals: rowSignals({ evidence, confidence: f.confidence, rowUnit: f.item.unit, codeUnit: row.suggestedInfo?.unit ?? null }, ta),
    alternatives: alts.map((a) => ({ code: a.code, name: a.name, path: a.info?.shortPath ?? '', confidence: a.confidence })),
    markingCurrent: row.currentInfo?.isMarked === true,
    markingSuggested: row.suggestedInfo?.isMarked === true,
    privileges,
    noSuggestion: noSuggestion(kind),
    mode: decisionMode({ ...kind, currentLive: current?.state === 'ok' }),
    nameOffer: await nameFromBarcode(f.item),
    advice: unitAdvice({ rawName: f.item.rawName, rowUnit: f.item.unit, code: f.item.existingMxik ? names.get(f.item.existingMxik) ?? null : null }),
    decision: f.decision,
    decisionEventId: f.decisionEventId,
    decisionSource: readDecisionSource(f.decisionSource),
    decidedBy: decider?.email ?? null,
    decidedAt: f.decidedAt?.toISOString() ?? null,
  };
}
