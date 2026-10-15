// Golden-set loader. CSV columns: name, unit, barcode (optional), correct_code,
// source (real | synthetic), notes. correct_code may list several defensible
// codes separated by "|"; the first is the primary label.
import { z } from 'zod';
import { parseCsv } from './csv.js';

export type CaseSource = 'real' | 'synthetic';

export type EvalCase = {
  id: string;
  name: string;
  unit: string | null;
  barcode: string | null;
  /** Every defensible code, primary first. */
  correct: string[];
  source: CaseSource;
  notes: string;
};

const REQUIRED = ['name', 'unit', 'correct_code', 'source', 'notes'] as const;

const Row = z.object({
  name: z.string().trim().min(1),
  unit: z.string().trim(),
  barcode: z.string().trim(),
  correct_code: z.string().trim().min(17),
  source: z.enum(['real', 'synthetic']),
  notes: z.string(),
});

export type LoadResult = { cases: EvalCase[]; errors: string[] };

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
      name: cell(row, 'name'), unit: cell(row, 'unit'), barcode: cell(row, 'barcode'),
      correct_code: cell(row, 'correct_code'), source: cell(row, 'source').trim().toLowerCase(),
      notes: cell(row, 'notes'),
    });
    if (!parsed.success) {
      errors.push(`${label}:${line}: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
      return;
    }
    const codes = parsed.data.correct_code.split('|').map((c) => c.trim()).filter(Boolean);
    const bad = codes.filter((c) => !/^\d{17}$/.test(c));
    if (bad.length > 0) {
      errors.push(`${label}:${line}: not a 17-digit code: ${bad.join(', ')}`);
      return;
    }
    cases.push({
      id: `${label}:${line}`,
      name: parsed.data.name,
      unit: parsed.data.unit || null,
      barcode: parsed.data.barcode || null,
      correct: codes,
      source: parsed.data.source,
      notes: parsed.data.notes,
    });
  });
  return { cases, errors };
}
