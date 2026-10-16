// Everything the row drawer shows for one finding, scoped to the org.
import { readEvidence } from '../core/match/evidence.js';
import { codeDetails, readableLevel } from './code-details';
import { db } from './db';
import { findingRows } from './finding-view';
import { rowSignals, type Signal } from './row-signals';

export type CodeBlock = { digits: string; name: string | null };
export type CodeView = { code: string; name: string; live: boolean; blocks: CodeBlock[] };

export type RowDetail = {
  findingId: string;
  productName: string;
  unit: string | null;
  barcode: string | null;
  type: string;
  reason: string;
  confidence: number | null;
  current: CodeView | null;
  suggested: CodeView | null;
  chosenMxik: string | null;
  signals: Signal[];
  alternatives: { code: string; name: string; path: string; confidence: number }[];
  markingCurrent: boolean;
  markingSuggested: boolean;
  privileges: string[];
  noSuggestion: boolean;
  decision: 'pending' | 'accepted' | 'rejected';
  decisionEventId: string | null;
};

/** Split points of the 17-digit code: guruh, sinf, pozitsiya, subpozitsiya, brend/atribut. */
const SPLITS = [3, 5, 8, 11, 17] as const;

type LevelNames = { groupNameUz: string | null; classNameUz: string | null; positionNameUz: string | null; subPositionNameUz: string | null; nameUz: string; retiredAt: Date | null };

function toView(code: string, names: LevelNames | undefined): CodeView {
  const levels = names ? [names.groupNameUz, names.classNameUz, names.positionNameUz, names.subPositionNameUz, names.nameUz] : [null, null, null, null, null];
  let from = 0;
  const blocks = SPLITS.map((to, i): CodeBlock => {
    const digits = code.slice(from, to);
    from = to;
    const raw = levels[i];
    return { digits, name: raw ? readableLevel(raw) : null };
  });
  return { code, name: names?.nameUz ?? '', live: names ? names.retiredAt === null : false, blocks };
}

export async function rowDetail(orgId: string, findingId: string): Promise<RowDetail | null> {
  const f = await db.finding.findFirst({
    where: { id: findingId, item: { catalog: { orgId } } },
    include: { item: { select: { id: true, rowIndex: true, rawName: true, existingMxik: true, unit: true, barcode: true } } },
  });
  if (!f) return null;
  const { rows } = await findingRows([f]);
  const row = rows[0];
  if (!row) return null;

  const alts = row.alternatives.filter((a) => a.code !== f.suggestedMxik).slice(0, 5);
  const codes = [...new Set([f.item.existingMxik, f.suggestedMxik, ...alts.map((a) => a.code)].filter((c): c is string => Boolean(c)))];
  const [levels, details] = await Promise.all([
    db.mxikCode.findMany({
      where: { code: { in: codes } },
      select: { code: true, groupNameUz: true, classNameUz: true, positionNameUz: true, subPositionNameUz: true, nameUz: true, retiredAt: true },
    }),
    codeDetails(codes),
  ]);
  const names = new Map(levels.map((l) => [l.code.trim(), l]));
  const view = (code: string | null): CodeView | null => (code ? toView(code, names.get(code)) : null);

  const ids = [...new Set([f.item.existingMxik, f.suggestedMxik].flatMap((c) => (c ? details.get(c)?.taxPrivilegeIds ?? [] : [])))];
  const privileges = ids.length === 0 ? [] : (await db.taxPrivilege.findMany({ where: { id: { in: ids } }, select: { id: true, nameLatn: true } }))
    .map((p) => p.nameLatn ?? p.id);

  const evidence = readEvidence(f.evidence) ?? row.evidence;
  return {
    findingId: f.id,
    productName: f.item.rawName,
    unit: f.item.unit,
    barcode: f.item.barcode,
    type: f.type,
    reason: f.reason,
    confidence: f.confidence,
    current: view(f.item.existingMxik),
    suggested: view(f.suggestedMxik),
    chosenMxik: f.chosenMxik,
    signals: rowSignals({ evidence, confidence: f.confidence, rowUnit: f.item.unit, codeUnit: row.suggestedInfo?.unit ?? null }),
    alternatives: alts.map((a) => ({ code: a.code, name: a.name, path: a.info?.shortPath ?? '', confidence: a.confidence })),
    markingCurrent: row.currentInfo?.isMarked === true,
    markingSuggested: row.suggestedInfo?.isMarked === true,
    privileges,
    noSuggestion: !f.suggestedMxik || evidence?.rerankNone === true,
    decision: f.decision,
    decisionEventId: f.decisionEventId,
  };
}
