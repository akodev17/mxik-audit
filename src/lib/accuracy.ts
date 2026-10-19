// How good the suggestions are, from what reviewers did with them. Cross-org,
// so only the platform admin page reads it. Demo and test orgs are left out.
import { Prisma } from '@prisma/client';
import { CONFIDENCE_LABELS, type LabelKey } from '../core/match/confidence-labels';
import { formulaSafe } from './csv-safe';
import { db } from './db';

export type Dimension = 'stage' | 'label' | 'org' | 'week';
export const DIMENSIONS: Dimension[] = ['stage', 'label', 'org', 'week'];

export type AccuracyRow = { key: string; unchanged: number; replaced: number; rejected: number; open: number; decided: number; rate: number | null };

/** The words the app shows for each labelKey() key: a match band, never a certainty. */
export const LABEL_WORDING: Record<LabelKey, string> = {
  barcode: 'Shtrix-kod boʻyicha',
  dictionary: 'Firma lugʻatidan',
  sure: 'Yuqori moslik',
  likely: 'Oʻrtacha moslik',
  check: 'Tekshirish kerak',
};

/** A constant of this module as an SQL literal (no bind parameters, so GROUP BY 1 stays one expression). */
const literal = (value: string | number): Prisma.Sql =>
  Prisma.raw(typeof value === 'number' ? String(value) : `'${value.replace(/'/g, "''")}'`);

/** The label of a stored finding, decided in the same order and with the same thresholds as labelKey(). */
const LABEL_SQL = Prisma.sql`CASE
  WHEN f.evidence->>'stage' = 'barcode' THEN ${literal(LABEL_WORDING.barcode)}
  WHEN f.evidence->>'stage' = 'dictionary' THEN ${literal(LABEL_WORDING.dictionary)}
  WHEN f.confidence IS NULL THEN 'nomaʼlum'
  WHEN f.confidence >= ${literal(CONFIDENCE_LABELS.sure)} THEN ${literal(LABEL_WORDING.sure)}
  WHEN f.confidence >= ${literal(CONFIDENCE_LABELS.likely)} THEN ${literal(LABEL_WORDING.likely)}
  ELSE ${literal(LABEL_WORDING.check)} END`;

const KEY_SQL: Record<Dimension, Prisma.Sql> = {
  stage: Prisma.sql`coalesce(f.evidence->>'stage', 'nomaʼlum')`,
  label: LABEL_SQL,
  org: Prisma.sql`o.name`,
  week: Prisma.sql`to_char(date_trunc('week', coalesce(f."decidedAt", c."createdAt")), 'YYYY-MM-DD')`,
};

type Raw = { key: string; unchanged: bigint; replaced: bigint; rejected: bigint; open: bigint };

export async function accuracyBy(dim: Dimension): Promise<AccuracyRow[]> {
  const key = KEY_SQL[dim];
  const rows = await db.$queryRaw<Raw[]>(Prisma.sql`
    SELECT ${key} AS key,
      count(*) FILTER (WHERE f.decision = 'accepted' AND f."chosenMxik" = f."suggestedMxik") AS unchanged,
      count(*) FILTER (WHERE f.decision = 'accepted' AND f."chosenMxik" IS DISTINCT FROM f."suggestedMxik") AS replaced,
      count(*) FILTER (WHERE f.decision = 'rejected') AS rejected,
      count(*) FILTER (WHERE f.decision = 'pending') AS open
    FROM finding f
      JOIN catalog_item i ON i.id = f."itemId"
      JOIN catalog c ON c.id = i."catalogId"
      JOIN organization o ON o.id = c."orgId"
    WHERE f."suggestedMxik" IS NOT NULL AND f.type IN ('MISSING', 'NOT_FOUND', 'MISMATCH') AND o.kind = 'customer'
    GROUP BY 1 ORDER BY 1`);
  return rows.map((r) => {
    const unchanged = Number(r.unchanged);
    const replaced = Number(r.replaced);
    const rejected = Number(r.rejected);
    const decided = unchanged + replaced + rejected;
    return { key: r.key, unchanged, replaced, rejected, open: Number(r.open), decided, rate: decided === 0 ? null : unchanged / decided };
  });
}

export function overall(rows: readonly AccuracyRow[]): AccuracyRow {
  const sum = (pick: (r: AccuracyRow) => number): number => rows.reduce((a, r) => a + pick(r), 0);
  const unchanged = sum((r) => r.unchanged);
  const decided = sum((r) => r.decided);
  return { key: 'jami', unchanged, replaced: sum((r) => r.replaced), rejected: sum((r) => r.rejected), open: sum((r) => r.open), decided, rate: decided === 0 ? null : unchanged / decided };
}

export type WrongReason = { reason: string; count: number; examples: { product: string; code: string | null; note: string | null }[] };

export async function wrongReasons(): Promise<WrongReason[]> {
  const grouped = await db.suggestionFeedback.groupBy({ by: ['reason'], _count: { _all: true }, orderBy: { _count: { reason: 'desc' } } });
  return Promise.all(grouped.map(async (g) => ({
    reason: g.reason,
    count: g._count._all,
    examples: (await db.suggestionFeedback.findMany({
      where: { reason: g.reason }, orderBy: { createdAt: 'desc' }, take: 3,
      select: { productName: true, suggestedMxik: true, note: true },
    })).map((e) => ({ product: e.productName, code: e.suggestedMxik, note: e.note })),
  })));
}

/** One CSV cell: text that Excel would run as a formula (= + - @ tab CR) gets a leading apostrophe. */
export const csvCell = (v: string | number | null): string => {
  const s = v === null ? '' : typeof v === 'number' ? String(v) : formulaSafe(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function accuracyCsv(dim: Dimension): Promise<string> {
  const rows = await accuracyBy(dim);
  const head = [dim, 'accepted_unchanged', 'replaced', 'rejected', 'open', 'accept_rate'];
  return [head, ...rows.map((r) => [r.key, r.unchanged, r.replaced, r.rejected, r.open, r.rate === null ? '' : r.rate.toFixed(4)])]
    .map((cells) => cells.map(csvCell).join(',')).join('\n') + '\n';
}

export async function reasonsCsv(): Promise<string> {
  const rows = await db.suggestionFeedback.findMany({ orderBy: { createdAt: 'desc' }, take: 5000, select: { reason: true, stage: true, label: true, productName: true, suggestedMxik: true, note: true, createdAt: true } });
  return [['reason', 'stage', 'label', 'product', 'suggested_code', 'note', 'date'], ...rows.map((r) => [r.reason, r.stage, r.label, r.productName, r.suggestedMxik, r.note, r.createdAt.toISOString()])]
    .map((cells) => cells.map((c) => csvCell(c)).join(',')).join('\n') + '\n';
}
