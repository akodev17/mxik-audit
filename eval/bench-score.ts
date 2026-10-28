// Scoring for `npm run bench:files`: a test catalogue's answer key (the "Javob kaliti" sheet)
// against what the audit found per row. Pure, so the arithmetic is tested apart from the DB.
//
// Answer-key columns (by header, any order): "Excel qatori", "Nom", "Kutilgan natija" (human
// label), "Topilmalar" (finding types, comma separated, "-" = none), "Kutilgan kod" (the code a
// right first suggestion may carry, "|" alternatives, "07306001*" prefixes; empty = not scored)
// and "Import" ("dublikat" | "nomsiz" | empty).
import { accepts } from './cases.js';

/** Finding types an answer key states. Other types (privileges, purchases) are counted, not scored. */
export const SCORED_TYPES = ['MISSING', 'NOT_FOUND', 'MISMATCH', 'UNIT_CONFLICT', 'RESTRICTED', 'TNVED_MISMATCH'] as const;
export type ScoredType = (typeof SCORED_TYPES)[number];
const isScored = (t: string): t is ScoredType => (SCORED_TYPES as readonly string[]).includes(t);

/** Codes are compared by position (group, class, position: 8 digits) for the lenient top-1. */
const POSITION = 8;

export type KeyRow = {
  excelRow: number;
  name: string;
  /** The human label ("xatosiz", "kod yoʻq", …), for the per-kind breakdown. */
  kind: string;
  expected: ScoredType[];
  /** Codes or prefixes a right suggestion may carry; empty when the row's suggestion is not scored. */
  want: string[];
  importFlag: 'dublikat' | 'nomsiz' | null;
};

/** What the audit said about one row. */
export type RowResult = {
  excelRow: number;
  types: string[];
  /** The pipeline's first suggestion (what a MISSING, NOT_FOUND or MISMATCH finding proposes). */
  top1: string | null;
};

export type TypeScore = { expected: number; got: number; tp: number; precision: number | null; recall: number | null };
export type RateScore = { n: number; hit: number; position: number; pct: number | null };

export type FileScore = {
  /** Data rows in the file, the nameless one included. */
  rows: number;
  /** Rows the audit checked (rows with a name). */
  audited: number;
  byType: Record<ScoredType, TypeScore>;
  /** Findings of types the key does not state, by type. */
  unscored: Record<string, number>;
  /** Rows without a code (MISSING expected): first suggestion right. */
  top1: RateScore;
  /** Rows with a wrong or unknown code (MISMATCH / NOT_FOUND expected): first suggestion right. */
  fix: RateScore;
  /** Import diagnostics: duplicates and nameless rows, expected vs reported. */
  imports: { duplicates: { expected: number; got: number }; noName: { expected: number; got: number } };
  /** Audited rows whose scored finding types equal the key's exactly. */
  rowsExact: number;
  /** Per human label: rows, rows exactly right. */
  byKind: Record<string, { n: number; exact: number }>;
};

const norm = (s: string): string => s.trim().toLowerCase().replace(/[ʻʼ’'`]/g, '');

const COLUMNS = {
  excelRow: 'excel qatori', name: 'nom', kind: 'kutilgan natija', expected: 'topilmalar', want: 'kutilgan kod', importFlag: 'import',
} as const;

/** Reads the answer-key sheet (header row first). Throws on a missing column or an unknown finding type. */
export function parseKey(grid: readonly (readonly string[])[]): KeyRow[] {
  const [header, ...body] = grid;
  if (!header) throw new Error('answer key: empty sheet');
  const index = new Map(header.map((h, i) => [norm(h), i]));
  const col = (name: string): number => {
    const i = index.get(name);
    if (i === undefined) throw new Error(`answer key: no "${name}" column`);
    return i;
  };
  const at = Object.fromEntries(Object.entries(COLUMNS).map(([k, v]) => [k, col(v)])) as Record<keyof typeof COLUMNS, number>;
  return body.filter((r) => r.some((c) => c.trim() !== '')).map((r) => {
    const cell = (i: number): string => (r[i] ?? '').trim();
    const types = cell(at.expected).split(/[,+\s]+/).filter((t) => t !== '' && t !== '-');
    const unknown = types.filter((t) => !isScored(t));
    if (unknown.length > 0) throw new Error(`answer key row ${cell(at.excelRow)}: unknown finding type ${unknown.join(', ')}`);
    const flag = cell(at.importFlag).toLowerCase();
    return {
      excelRow: Number(cell(at.excelRow)),
      name: cell(at.name),
      kind: cell(at.kind),
      expected: types as ScoredType[],
      want: cell(at.want).split('|').map((c) => c.trim()).filter(Boolean),
      importFlag: flag === 'dublikat' || flag === 'nomsiz' ? flag : null,
    };
  });
}

const ratio = (a: number, b: number): number | null => (b === 0 ? null : (100 * a) / b);

function rate(rows: readonly { want: string[]; top1: string | null }[]): RateScore {
  const hit = rows.filter((r) => r.top1 !== null && accepts(r.want, r.top1)).length;
  const position = rows.filter((r) => r.top1 !== null && r.want.some((w) => r.top1?.startsWith(w.replace(/\*$/, '').slice(0, POSITION)))).length;
  return { n: rows.length, hit, position, pct: ratio(hit, rows.length) };
}

/**
 * Scores one file. `results` holds the audited rows by Excel row; a key row that is neither
 * nameless nor in `results` is an alignment error and throws.
 */
export function scoreFile(
  key: readonly KeyRow[],
  results: ReadonlyMap<number, RowResult>,
  imports: { duplicates: number; noName: number },
): FileScore {
  const byType = Object.fromEntries(SCORED_TYPES.map((t) => [t, { expected: 0, got: 0, tp: 0, precision: null, recall: null }])) as Record<ScoredType, TypeScore>;
  const unscored: Record<string, number> = {};
  const byKind: FileScore['byKind'] = {};
  const top1Rows: { want: string[]; top1: string | null }[] = [];
  const fixRows: { want: string[]; top1: string | null }[] = [];
  let audited = 0;
  let rowsExact = 0;

  for (const row of key) {
    if (row.importFlag === 'nomsiz') continue;
    const result = results.get(row.excelRow);
    if (!result) throw new Error(`row ${row.excelRow} (${row.name}) has no audit result`);
    audited++;
    const got = new Set(result.types.filter(isScored));
    for (const t of result.types.filter((x) => !isScored(x))) unscored[t] = (unscored[t] ?? 0) + 1;
    for (const t of SCORED_TYPES) {
      const want = row.expected.includes(t);
      const has = got.has(t);
      if (want) byType[t].expected++;
      if (has) byType[t].got++;
      if (want && has) byType[t].tp++;
    }
    const exact = got.size === row.expected.length && row.expected.every((t) => got.has(t));
    if (exact) rowsExact++;
    const kind = (byKind[row.kind] ??= { n: 0, exact: 0 });
    kind.n++;
    if (exact) kind.exact++;
    if (row.want.length > 0) {
      if (row.expected.includes('MISSING')) top1Rows.push({ want: row.want, top1: result.top1 });
      else if (row.expected.includes('NOT_FOUND') || row.expected.includes('MISMATCH')) fixRows.push({ want: row.want, top1: result.top1 });
    }
  }
  for (const s of Object.values(byType)) {
    s.precision = ratio(s.tp, s.got);
    s.recall = ratio(s.tp, s.expected);
  }
  return {
    rows: key.length,
    audited,
    byType,
    unscored,
    top1: rate(top1Rows),
    fix: rate(fixRows),
    imports: {
      duplicates: { expected: key.filter((r) => r.importFlag === 'dublikat').length, got: imports.duplicates },
      noName: { expected: key.filter((r) => r.importFlag === 'nomsiz').length, got: imports.noName },
    },
    rowsExact,
    byKind,
  };
}

/** Sums several files' scores into one (rates and precision recomputed from the counts). */
export function totalScore(files: readonly FileScore[]): FileScore {
  const byType = Object.fromEntries(SCORED_TYPES.map((t) => {
    const expected = files.reduce((n, f) => n + f.byType[t].expected, 0);
    const got = files.reduce((n, f) => n + f.byType[t].got, 0);
    const tp = files.reduce((n, f) => n + f.byType[t].tp, 0);
    return [t, { expected, got, tp, precision: ratio(tp, got), recall: ratio(tp, expected) }];
  })) as Record<ScoredType, TypeScore>;
  const sumRate = (pick: (f: FileScore) => RateScore): RateScore => {
    const n = files.reduce((s, f) => s + pick(f).n, 0);
    const hit = files.reduce((s, f) => s + pick(f).hit, 0);
    return { n, hit, position: files.reduce((s, f) => s + pick(f).position, 0), pct: ratio(hit, n) };
  };
  const unscored: Record<string, number> = {};
  const byKind: FileScore['byKind'] = {};
  for (const f of files) {
    for (const [t, n] of Object.entries(f.unscored)) unscored[t] = (unscored[t] ?? 0) + n;
    for (const [k, v] of Object.entries(f.byKind)) {
      const kind = (byKind[k] ??= { n: 0, exact: 0 });
      kind.n += v.n;
      kind.exact += v.exact;
    }
  }
  const sum = (pick: (f: FileScore) => number): number => files.reduce((s, f) => s + pick(f), 0);
  return {
    rows: sum((f) => f.rows),
    audited: sum((f) => f.audited),
    byType,
    unscored,
    top1: sumRate((f) => f.top1),
    fix: sumRate((f) => f.fix),
    imports: {
      duplicates: { expected: sum((f) => f.imports.duplicates.expected), got: sum((f) => f.imports.duplicates.got) },
      noName: { expected: sum((f) => f.imports.noName.expected), got: sum((f) => f.imports.noName.got) },
    },
    rowsExact: sum((f) => f.rowsExact),
    byKind,
  };
}
