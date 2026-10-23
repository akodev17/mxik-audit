// Golden-set loader. CSV columns: name, unit, barcode (optional), tnved
// (optional: the row's TIF TN / TN VED code, as a customs file has it), correct_code,
// source (real | synthetic), notes. correct_code may list several defensible
// codes separated by "|"; the first is the primary label. An entry ending in "*"
// is a code prefix: "07306001*" accepts every code in that 8-digit position,
// for products where any identifying code of the position is defensible.
import { z } from 'zod';
import { parseCsv } from './csv.js';

export type CaseSource = 'real' | 'synthetic';

export type EvalCase = {
  id: string;
  name: string;
  unit: string | null;
  barcode: string | null;
  /** TIF TN (TN VED) code as the file has it; its heading limits retrieval (core/match/tnved.ts). */
  tnved: string | null;
  /** Every defensible code or code prefix ("07306001*"), primary first. */
  correct: string[];
  source: CaseSource;
  notes: string;
};

const REQUIRED = ['name', 'unit', 'correct_code', 'source', 'notes'] as const;

const Row = z.object({
  name: z.string().trim().min(1),
  unit: z.string().trim(),
  barcode: z.string().trim(),
  tnved: z.string().trim(),
  correct_code: z.string().trim().min(1),
  source: z.enum(['real', 'synthetic']),
  notes: z.string(),
});

export type LoadResult = { cases: EvalCase[]; errors: string[] };

const CODE = /^\d{17}$/;
/** At least a position: the 8 digits of group, class and position. */
const PREFIX = /^\d{8,16}\*$/;

export const isPrefix = (label: string): boolean => label.endsWith('*');

/** True when `code` is one of the labels or falls under one of the prefixes. */
export function accepts(correct: readonly string[], code: string): boolean {
  return correct.some((label) => (isPrefix(label) ? code.startsWith(label.slice(0, -1)) : label === code));
}

/** Parses one CSV file. Bad rows are reported, never silently dropped. */
export function parseCases(text: string, label: string): LoadResult {
  const [header, ...body] = parseCsv(text);
  if (!header) return { cases: [], errors: [`${label}: empty file`] };
  const index = new Map(header.map((h, i) => [h.trim().toLowerCase(), i]));
  const missing = REQUIRED.filter((c) => !index.has(c));
  if (missing.length > 0) return { cases: [], errors: [`${label}: missing column(s) ${missing.join(', ')}`] };

  const cell = (row: string[], col: string): string => {
    const i = index.get(col);
    return i === undefined ? '' : (row[i] ?? '');
  };

  const cases: EvalCase[] = [];
  const errors: string[] = [];
  body.forEach((row, n) => {
    const line = n + 2;
    const parsed = Row.safeParse({
      name: cell(row, 'name'), unit: cell(row, 'unit'), barcode: cell(row, 'barcode'), tnved: cell(row, 'tnved'),
      correct_code: cell(row, 'correct_code'), source: cell(row, 'source').trim().toLowerCase(),
      notes: cell(row, 'notes'),
    });
    if (!parsed.success) {
      errors.push(`${label}:${line}: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
      return;
    }
    const codes = parsed.data.correct_code.split('|').map((c) => c.trim()).filter(Boolean);
    const bad = codes.filter((c) => !CODE.test(c) && !PREFIX.test(c));
    if (bad.length > 0) {
      errors.push(`${label}:${line}: not a 17-digit code or code prefix: ${bad.join(', ')}`);
      return;
    }
    cases.push({
      id: `${label}:${line}`,
      name: parsed.data.name,
      unit: parsed.data.unit || null,
      barcode: parsed.data.barcode || null,
      tnved: parsed.data.tnved || null,
      correct: codes,
      source: parsed.data.source,
      notes: parsed.data.notes,
    });
  });
  return { cases, errors };
}
