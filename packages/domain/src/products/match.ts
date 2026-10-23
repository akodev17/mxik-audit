// matchProducts: which of the org's own products an incoming line (an invoice line, a catalogue
// row) is. Deterministic keys first, strongest first, each a bulk query for all lines at once:
//
//   onec_ref → barcode (GTIN with a valid check digit) → MXIK + unit (name similar enough) →
//   exact name → normalised name → alias → confirmed mapping (FirmMapping code → the product
//   holding it) → pg_trgm name similarity (one bounded LATERAL query for the remaining lines)
//
// A line is `matched` only on a single certain candidate: one deterministic hit, or a similarity
// at or above MATCH_SIMILARITY with a clear margin over the runner-up, the same unit and the same
// numbers in the name (so "1,5 л" never becomes "0,5 л"). Several plausible candidates are
// `ambiguous` (up to five, each with its reason), nothing plausible is `new`. Server-only.
import { dictionaryKeys } from '@tasnivo/core/match/dictionary';
import { db } from '@tasnivo/db';
import type { accounting } from '@tasnivo/contracts';
import type { Locale } from '@tasnivo/i18n/i18n';
import { i18nFor } from '@tasnivo/i18n/locale';
import type { z } from 'zod';
import { barcodeKey, mxikOf, numbersOf, productNameKey, unitKeyOf } from './keys.js';

type MatchResult = z.infer<typeof accounting.MatchResult>;
type MatchCandidate = z.infer<typeof accounting.MatchCandidate>;
type Basis = MatchCandidate['basis'];

export type MatchLine = { name: string; mxik?: string | null; barcode?: string | null; unit?: string | null; packageCode?: string | null; onecRef?: string | null };

/** pg_trgm similarity a single winner needs to be `matched` (with MATCH_MARGIN over the next). Tuned on the 50-product fixture and the 1 000-row benchmark (products/README in agent4-result.md). */
export const MATCH_SIMILARITY = 0.8;
export const MATCH_MARGIN = 0.1;
/** Below this, a similar name is not even a candidate. */
export const CANDIDATE_SIMILARITY = 0.45;
/** An MXIK + unit hit still needs the names to be this similar before it is taken as the same product. */
export const MXIK_NAME_FLOOR = 0.35;
const MAX_CANDIDATES = 5;

type Row = { id: string; name: string; normalizedName: string; unitKey: string; mxik: string | null; barcode: string | null; onecRef: string | null; clientId: string | null };

const SELECT = { id: true, name: true, normalizedName: true, unitKey: true, mxik: true, barcode: true, onecRef: true, clientId: true } as const;

const fill = (template: string, params: Record<string, string | number>): string =>
  template.replace(/\{(\w+)\}/g, (_, key: string) => String(params[key] ?? ''));

/** Trigram similarity of two keys, the same measure as pg_trgm's similarity() (for the MXIK + unit guard). */
export function trigramSimilarity(a: string, b: string): number {
  const grams = (s: string): Set<string> => {
    const out = new Set<string>();
    for (const word of s.split(' ').filter(Boolean)) {
      const padded = `  ${word} `;
      for (let i = 0; i + 3 <= padded.length; i++) out.add(padded.slice(i, i + 3));
    }
    return out;
  };
  const ga = grams(a);
  const gb = grams(b);
  if (ga.size === 0 || gb.size === 0) return 0;
  let shared = 0;
  for (const g of ga) if (gb.has(g)) shared++;
  return shared / (ga.size + gb.size - shared);
}

/** Products visible to a match for this client: the client's own and the org's own (clientId null). */
function scopeWhere(orgId: string, clientId: string | null) {
  return clientId ? { orgId, OR: [{ clientId }, { clientId: null }] } : { orgId, clientId: null };
}

/** The client's own product wins a tie over the org's shared one. */
function preferClient<T extends { clientId: string | null }>(rows: T[], clientId: string | null): T[] {
  if (!clientId || rows.length < 2) return rows;
  const own = rows.filter((r) => r.clientId === clientId);
  return own.length > 0 ? own : rows;
}

function groupBy<T>(rows: readonly T[], key: (r: T) => string | null): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    if (k === null) continue;
    out.set(k, [...(out.get(k) ?? []), r]);
  }
  return out;
}

type Prepared = { line: MatchLine; nameKey: string; unitKey: string; barcode: string | null; mxik: string | null; onecRef: string | null; dictName: string | null; dictBarcode: string | null };

/** Matches every line against the org's (and client's) products; one answer per line, in order. */
export async function matchLines(orgId: string, clientId: string | null, lines: readonly MatchLine[], locale: Locale = 'uz'): Promise<MatchResult[]> {
  const m = i18nFor(locale).ta.productsX.match;
  const prepared: Prepared[] = lines.map((line) => {
    const keys = dictionaryKeys({ rawName: line.name, unit: line.unit ?? null, barcode: line.barcode ?? null });
    return {
      line, nameKey: productNameKey(line.name), unitKey: unitKeyOf(line.unit), barcode: barcodeKey(line.barcode).identity,
      mxik: mxikOf(line.mxik).code, onecRef: line.onecRef?.trim() || null, dictName: keys.name, dictBarcode: keys.barcode,
    };
  });
  const scope = scopeWhere(orgId, clientId);
  const distinct = (xs: (string | null)[]): string[] => [...new Set(xs.filter((x): x is string => Boolean(x)))];

  const [byRef, byBarcode, byMxik, byName, aliases, mappings] = await Promise.all([
    distinct(prepared.map((p) => p.onecRef)).length === 0 ? [] : db.product.findMany({ where: { ...scope, onecRef: { in: distinct(prepared.map((p) => p.onecRef)) } }, select: SELECT }),
    distinct(prepared.map((p) => p.barcode)).length === 0 ? [] : db.product.findMany({ where: { ...scope, barcode: { in: distinct(prepared.map((p) => p.barcode)) } }, select: SELECT }),
    distinct(prepared.map((p) => p.mxik)).length === 0 ? [] : db.product.findMany({ where: { ...scope, mxik: { in: distinct(prepared.map((p) => p.mxik)) } }, select: SELECT, take: 5_000 }),
    distinct(prepared.map((p) => p.nameKey)).length === 0 ? [] : db.product.findMany({ where: { ...scope, normalizedName: { in: distinct(prepared.map((p) => p.nameKey)) } }, select: SELECT }),
    distinct(prepared.map((p) => p.nameKey)).length === 0 ? [] : db.productAlias.findMany({
      where: { orgId, normalizedAlias: { in: distinct(prepared.map((p) => p.nameKey)) }, product: scope },
      select: { normalizedAlias: true, alias: true, product: { select: SELECT } },
    }),
    db.firmMapping.findMany({
      where: { orgId, staleAt: null, OR: [
        { kind: 'name', key: { in: distinct(prepared.map((p) => p.dictName)) } },
        { kind: 'barcode', key: { in: distinct(prepared.map((p) => p.dictBarcode)) } },
      ] },
      select: { kind: true, key: true, code: true, confirmations: true },
    }),
  ]);
  const refMap = groupBy(byRef, (r) => r.onecRef);
  const barcodeMap = groupBy(byBarcode, (r) => r.barcode);
  const mxikMap = groupBy(byMxik, (r) => r.mxik?.trim() ?? null);
  const nameMap = groupBy(byName, (r) => r.normalizedName);
  const aliasMap = groupBy(aliases, (a) => a.normalizedAlias);
  const mappingMap = new Map(mappings.map((x) => [`${x.kind}:${x.key}`, x]));
  // Products holding a confirmed code that no line names directly.
  const mappedCodes = distinct(mappings.map((x) => x.code)).filter((c) => !mxikMap.has(c));
  if (mappedCodes.length > 0) {
    for (const r of await db.product.findMany({ where: { ...scope, mxik: { in: mappedCodes } }, select: SELECT, take: 5_000 })) {
      const k = r.mxik?.trim() ?? '';
      mxikMap.set(k, [...(mxikMap.get(k) ?? []), r]);
    }
  }

  const candidate = (r: Row, basis: Basis, confidence: number, reason: string): MatchCandidate => ({
    id: r.id, label: r.name, confidence: Math.max(0, Math.min(1, Number(confidence.toFixed(3)))), basis, reason,
  });
  const single = (rows: Row[] | undefined): Row | null => (rows && rows.length === 1 ? rows[0] ?? null : null);
  const answers: (MatchResult | null)[] = prepared.map((p) => {
    // 1. The 1C reference: the same catalogue entry.
    const ref = preferClient(p.onecRef ? refMap.get(p.onecRef) ?? [] : [], clientId);
    if (ref.length === 1 && ref[0]) return matched(candidate(ref[0], 'onec_ref', 1, m.onec_ref));
    // 2. A product-identifying barcode.
    const bc = preferClient(p.barcode ? barcodeMap.get(p.barcode) ?? [] : [], clientId);
    if (bc.length === 1 && bc[0]) return matched(candidate(bc[0], 'barcode', 0.99, m.barcode));
    if (bc.length > 1) return ambiguous(bc.map((r) => candidate(r, 'barcode', 0.9, m.barcode)));
    // 3. Same MXIK and unit, and a name close enough to be the same product.
    const sameCode = (p.mxik ? mxikMap.get(p.mxik) ?? [] : []).filter((r) => r.unitKey === p.unitKey || !p.unitKey || !r.unitKey);
    const closeCode = preferClient(sameCode.filter((r) => trigramSimilarity(r.normalizedName, p.nameKey) >= MXIK_NAME_FLOOR), clientId);
    const oneCode = single(closeCode);
    if (oneCode) return matched(candidate(oneCode, 'mxik', 0.95, fill(m.mxik, { pct: Math.round(trigramSimilarity(oneCode.normalizedName, p.nameKey) * 100) })));
    // 4. The normalised name (+ unit when both have one); exact when the written name is the same too.
    const sameName = preferClient((nameMap.get(p.nameKey) ?? []).filter((r) => r.unitKey === p.unitKey || !p.unitKey || !r.unitKey), clientId);
    const oneName = single(sameName);
    if (oneName) {
      const exact = oneName.name.trim().toLowerCase() === p.line.name.trim().toLowerCase();
      return matched(candidate(oneName, exact ? 'name_exact' : 'name_normalized', exact ? 0.98 : 0.95, exact ? m.name_exact : m.name_normalized));
    }
    // 5. A name the product was seen under before.
    const viaAlias = preferClient([...new Map((aliasMap.get(p.nameKey) ?? []).map((a) => [a.product.id, a.product])).values()]
      .filter((r) => r.unitKey === p.unitKey || !p.unitKey || !r.unitKey), clientId);
    const oneAlias = single(viaAlias);
    if (oneAlias) return matched(candidate(oneAlias, 'alias', 0.93, m.alias));
    // 6. A code the org confirmed for this name or barcode (FirmMapping), held by exactly one product.
    const mapping = (p.dictBarcode ? mappingMap.get(`barcode:${p.dictBarcode}`) : undefined) ?? (p.dictName ? mappingMap.get(`name:${p.dictName}`) : undefined);
    const mapped = mapping ? preferClient((mxikMap.get(mapping.code) ?? []).filter((r) => r.unitKey === p.unitKey || !p.unitKey || !r.unitKey), clientId) : [];
    const oneMapped = single(mapped);
    if (mapping && oneMapped) return matched(candidate(oneMapped, 'confirmed_mapping', 0.9, fill(m.confirmed_mapping, { code: mapping.code })));

    // Several deterministic hits: the reviewer picks. Similarity runs for the rest.
    const several = [
      ...sameName.map((r) => candidate(r, 'name_normalized', 0.9, m.name_normalized)),
      ...viaAlias.map((r) => candidate(r, 'alias', 0.85, m.alias)),
      ...closeCode.map((r) => candidate(r, 'mxik', 0.8, fill(m.mxik, { pct: Math.round(trigramSimilarity(r.normalizedName, p.nameKey) * 100) }))),
      ...mapped.map((r) => candidate(r, 'confirmed_mapping', 0.8, fill(m.confirmed_mapping, { code: mapping?.code ?? '' }))),
    ];
    return several.length > 0 ? ambiguous(several) : null;
  });

  // 7. Name similarity for lines nothing above decided: one LATERAL query, five neighbours each.
  const open = prepared.map((p, i) => ({ p, i })).filter(({ i }) => answers[i] === null);
  const withKey = open.filter(({ p }) => p.nameKey.length >= 3);
  const near = withKey.length === 0 ? [] : await similarProducts(orgId, clientId, withKey.map(({ p }) => p.nameKey));
  const nearByLine = groupBy(near, (n) => String(n.idx));
  for (const [k, { p, i }] of withKey.entries()) {
    const hits = (nearByLine.get(String(k + 1)) ?? []).sort((a, b) => b.sim - a.sim);
    const scored = hits.map((h) => {
      const unitOk = !p.unitKey || !h.unitKey || h.unitKey === p.unitKey;
      const numbersOk = numbersOf(h.normalizedName) === numbersOf(p.nameKey);
      const notes = [!unitOk ? m.unitDiffers : null, !numbersOk ? m.numbersDiffer : null].filter(Boolean).join(', ');
      const reason = fill(m.similar, { pct: Math.round(h.sim * 100) }) + (notes ? ` — ${notes}` : '');
      return { h, unitOk, numbersOk, c: candidate(h, 'name_normalized', h.sim * (unitOk ? 1 : 0.8) * (numbersOk ? 1 : 0.8), reason) };
    });
    const [best, second] = scored;
    if (best && best.h.sim >= MATCH_SIMILARITY && best.unitOk && best.numbersOk && (!second || best.h.sim - second.h.sim >= MATCH_MARGIN)) {
      answers[i] = matched(best.c);
    } else if (scored.length > 0) {
      answers[i] = ambiguous(scored.map((s) => s.c));
    }
  }
  return answers.map((a) => a ?? { status: 'new', chosen: null, candidates: [] });
}

function matched(c: MatchCandidate): MatchResult {
  return { status: 'matched', chosen: c, candidates: [c] };
}

function ambiguous(cs: MatchCandidate[]): MatchResult {
  const seen = new Set<string>();
  const unique = cs.sort((a, b) => b.confidence - a.confidence).filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)));
  return { status: 'ambiguous', chosen: null, candidates: unique.slice(0, MAX_CANDIDATES) };
}

type Near = Row & { idx: number; sim: number };

/** Up to five products per key above CANDIDATE_SIMILARITY, through the trigram index. */
async function similarProducts(orgId: string, clientId: string | null, keys: string[]): Promise<Near[]> {
  // `%` uses the GIN index at pg_trgm.similarity_threshold; set for this transaction only.
  const [, rows] = await db.$transaction([
    db.$executeRaw`SELECT set_config('pg_trgm.similarity_threshold', ${String(CANDIDATE_SIMILARITY)}, true)`,
    db.$queryRaw<Near[]>`
      SELECT q.idx::int AS idx, p.id, p.name, p."normalizedName", p."unitKey", p.mxik, p.barcode, p."onecRef", p."clientId", p.sim::float AS sim
      FROM unnest(${keys}::text[]) WITH ORDINALITY AS q(key, idx)
      CROSS JOIN LATERAL (
        SELECT p.*, similarity(p."normalizedName", q.key) AS sim
        FROM product p
        WHERE p."orgId" = ${orgId}
          AND (p."clientId" IS NULL OR p."clientId" = ${clientId})
          AND p."normalizedName" % q.key
        ORDER BY sim DESC, (p."clientId" IS NULL) ASC, p.id
        LIMIT ${MAX_CANDIDATES}
      ) p`,
  ]);
  return rows.map((r) => ({ ...r, mxik: r.mxik?.trim() ?? null }));
}
