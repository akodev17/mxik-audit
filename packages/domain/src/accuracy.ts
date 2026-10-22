// How good the suggestions are, from what reviewers did with them. Cross-org,
// so only the platform admin page reads it. Demo and test orgs are left out.
// The SQL returns stable keys; words are chosen per viewer language (keyText).
import { Prisma } from '@prisma/client';
import { CONFIDENCE_LABELS, type LabelKey } from '@tasnivo/core/match/confidence-labels';
import { formulaSafe } from './csv-safe';
import { db } from '@tasnivo/db';
import { dict, type Locale } from '@tasnivo/i18n/i18n';
import { appDict } from '@tasnivo/i18n/i18n-app';

export type Dimension = 'stage' | 'label' | 'org' | 'week';
export const DIMENSIONS: Dimension[] = ['stage', 'label', 'org', 'week'];

export type AccuracyRow = { key: string; unchanged: number; replaced: number; rejected: number; open: number; decided: number; rate: number | null };

/** Key of rows with no stage, or no score to band. */
export const UNKNOWN_KEY = 'unknown';
const UNKNOWN_WORD: Record<Locale, string> = { uz: 'Nomaʼlum', ru: 'Неизвестно' };

/** Label keys in reading order: score bands from best, then the identity sources. */
const LABEL_ORDER: readonly string[] = ['sure', 'likely', 'check', 'barcode', 'dictionary', UNKNOWN_KEY] satisfies readonly (LabelKey | typeof UNKNOWN_KEY)[];

/** The words the app shows for each labelKey() key: a match band, never a certainty. */
export function labelWords(locale: Locale): Record<LabelKey, string> {
  const t = dict(locale);
  const ta = appDict(locale);
  return {
    barcode: ta.matchX.label.barcode,
    dictionary: ta.matchX.label.dictionary,
    sure: t.confidenceSure,
    likely: t.confidenceLikely,
    check: t.confidenceCheck,
  };
}

/** How a row key reads: label keys and "unknown" in the viewer's language; stages, orgs and weeks as stored. */
export function keyText(dim: Dimension, key: string, locale: Locale): string {
  if (dim !== 'stage' && dim !== 'label') return key;
  if (key === UNKNOWN_KEY) return UNKNOWN_WORD[locale];
  if (dim === 'stage' || !LABEL_ORDER.includes(key)) return key;
  return labelWords(locale)[key as LabelKey];
}

/** A constant of this module as an SQL literal (no bind parameters, so GROUP BY 1 stays one expression). */
const literal = (value: string | number): Prisma.Sql =>
  Prisma.raw(typeof value === 'number' ? String(value) : `'${value.replace(/'/g, "''")}'`);

/** The label key of a stored finding, decided in the same order and with the same thresholds as labelKey(). */
const LABEL_SQL = Prisma.sql`CASE
  WHEN f.evidence->>'stage' = 'barcode' THEN 'barcode'
  WHEN f.evidence->>'stage' = 'dictionary' THEN 'dictionary'
  WHEN f.confidence IS NULL THEN ${literal(UNKNOWN_KEY)}
  WHEN f.confidence >= ${literal(CONFIDENCE_LABELS.sure)} THEN 'sure'
  WHEN f.confidence >= ${literal(CONFIDENCE_LABELS.likely)} THEN 'likely'
  ELSE 'check' END`;

const KEY_SQL: Record<Dimension, Prisma.Sql> = {
  stage: Prisma.sql`coalesce(f.evidence->>'stage', ${literal(UNKNOWN_KEY)})`,
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
  const out = rows.map((r) => {
    const unchanged = Number(r.unchanged);
    const replaced = Number(r.replaced);
    const rejected = Number(r.rejected);
    const decided = unchanged + replaced + rejected;
    return { key: r.key, unchanged, replaced, rejected, open: Number(r.open), decided, rate: decided === 0 ? null : unchanged / decided };
  });
  return dim === 'label' ? out.sort((a, b) => LABEL_ORDER.indexOf(a.key) - LABEL_ORDER.indexOf(b.key)) : out;
}

export function overall(rows: readonly AccuracyRow[]): AccuracyRow {
  const sum = (pick: (r: AccuracyRow) => number): number => rows.reduce((a, r) => a + pick(r), 0);
  const unchanged = sum((r) => r.unchanged);
  const decided = sum((r) => r.decided);
  return { key: 'total', unchanged, replaced: sum((r) => r.replaced), rejected: sum((r) => r.rejected), open: sum((r) => r.open), decided, rate: decided === 0 ? null : unchanged / decided };
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

/** A "wrong suggestion" reason key in the viewer's language; an unknown key as stored. */
export function reasonText(reason: string, locale: Locale): string {
  const words: Record<string, string> = appDict(locale).wrong.reasons;
  return Object.prototype.hasOwnProperty.call(words, reason) ? words[reason] ?? reason : reason;
}

/** One CSV cell: text that Excel would run as a formula (= + - @ tab CR) gets a leading apostrophe. */
export const csvCell = (v: string | number | null): string => {
  const s = v === null ? '' : typeof v === 'number' ? String(v) : formulaSafe(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const toCsv = (rows: (string | number | null)[][]): string => rows.map((cells) => cells.map(csvCell).join(',')).join('\n') + '\n';

/** Stable key first (for scripts), then the same row as the page words it, in the viewer's language (the CSV route passes the request's). */
export async function accuracyCsv(dim: Dimension, lang: Locale): Promise<string> {
  const rows = await accuracyBy(dim);
  const head = [dim, `${dim}_name`, 'accepted_unchanged', 'replaced', 'rejected', 'open', 'accept_rate'];
  return toCsv([head, ...rows.map((r) => [r.key, keyText(dim, r.key, lang), r.unchanged, r.replaced, r.rejected, r.open, r.rate === null ? '' : r.rate.toFixed(4)])]);
}

export async function reasonsCsv(lang: Locale): Promise<string> {
  const rows = await db.suggestionFeedback.findMany({ orderBy: { createdAt: 'desc' }, take: 5000, select: { reason: true, stage: true, label: true, productName: true, suggestedMxik: true, note: true, createdAt: true } });
  const head = ['reason', 'reason_name', 'stage', 'label', 'label_name', 'product', 'suggested_code', 'note', 'date'];
  return toCsv([head, ...rows.map((r) => [
    r.reason, reasonText(r.reason, lang), r.stage, r.label, r.label === null ? null : keyText('label', r.label, lang),
    r.productName, r.suggestedMxik, r.note, r.createdAt.toISOString(),
  ])]);
}

/** The metrics page for one dimension: its table, the total over it, and why suggestions were called wrong. */
export async function accuracyReport(dim: Dimension): Promise<{ rows: AccuracyRow[]; overall: AccuracyRow; wrongReasons: WrongReason[] }> {
  const [rows, reasons] = await Promise.all([accuracyBy(dim), wrongReasons()]);
  return { rows, overall: overall(rows), wrongReasons: reasons };
}

/** GET /api/admin/metrics?by=…: a dimension's table or the reasons list as CSV; null for an unknown `by`. */
export async function metricsCsv(by: string, lang: Locale): Promise<string | null> {
  if (by === 'reasons') return reasonsCsv(lang);
  return DIMENSIONS.includes(by as Dimension) ? accuracyCsv(by as Dimension, lang) : null;
}
