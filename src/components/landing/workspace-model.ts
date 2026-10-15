// The landing workspace's logic, kept pure so it can be tested: which rows a
// filter shows, the counts on the filter tabs, and the plain-language reading
// of a row. Everything here is derived from the frozen sample audit; nothing
// is decided on the page.
//
// Wording follows the app (src/lib/i18n.ts): finding types, severities and the
// confidence bands (≥ 0.9 "Yuqori ishonch", ≥ 0.6 "Tekshirish kerak", below
// "Past ishonch") — the same thresholds as bandOf in src/core/match/score.ts.
import type { SampleCatalogRow, SampleCode, SampleFindingType } from '@/lib/sample-report.generated';

export type Filter = 'risky' | SampleFindingType | 'clean' | 'all';

export const TYPE_META: Record<SampleFindingType, { label: string; severity: 'high' | 'medium'; tone: 'risk' | 'caution' }> = {
  MISSING: { label: 'Kod yoʻq', severity: 'high', tone: 'risk' },
  NOT_FOUND: { label: 'Bazada topilmadi', severity: 'high', tone: 'risk' },
  MISMATCH: { label: 'Nomga mos emas', severity: 'medium', tone: 'caution' },
  UNIT_CONFLICT: { label: 'Oʻlchov birligi', severity: 'medium', tone: 'caution' },
};

/** Tab order: what needs attention first, then the reassurance, then everything. */
export const FILTERS: readonly { key: Filter; label: string }[] = [
  { key: 'risky', label: 'Riskli' },
  { key: 'MISSING', label: TYPE_META.MISSING.label },
  { key: 'NOT_FOUND', label: TYPE_META.NOT_FOUND.label },
  { key: 'MISMATCH', label: TYPE_META.MISMATCH.label },
  { key: 'UNIT_CONFLICT', label: TYPE_META.UNIT_CONFLICT.label },
  { key: 'clean', label: 'Muammosiz' },
  { key: 'all', label: 'Hammasi' },
];

const SEVERITY_ORDER: SampleFindingType[] = ['MISSING', 'NOT_FOUND', 'MISMATCH', 'UNIT_CONFLICT'];

/** The finding a row is listed under: the most severe one it has. */
export function primaryFinding(row: SampleCatalogRow): SampleCatalogRow['findings'][number] | null {
  for (const t of SEVERITY_ORDER) {
    const f = row.findings.find((x) => x.type === t);
    if (f) return f;
  }
  return null;
}

export function matches(row: SampleCatalogRow, filter: Filter): boolean {
  switch (filter) {
    case 'all': return true;
    case 'risky': return row.findings.length > 0;
    case 'clean': return row.findings.length === 0;
    default: return row.findings.some((f) => f.type === filter);
  }
}

export function rowsFor(catalog: readonly SampleCatalogRow[], filter: Filter): SampleCatalogRow[] {
  return catalog.filter((r) => matches(r, filter));
}

export function countsFor(catalog: readonly SampleCatalogRow[]): Record<Filter, number> {
  const out = Object.fromEntries(FILTERS.map((f) => [f.key, 0])) as Record<Filter, number>;
  for (const r of catalog) for (const f of FILTERS) if (matches(r, f.key)) out[f.key]++;
  return out;
}

export type Band = { key: 'high' | 'medium' | 'low'; label: string };

export function bandOf(confidence: number): Band {
  if (confidence >= 0.9) return { key: 'high', label: 'Yuqori ishonch' };
  if (confidence >= 0.6) return { key: 'medium', label: 'Tekshirish kerak' };
  return { key: 'low', label: 'Past ishonch' };
}

/**
 * Classifier group names arrive in capitals ("ALKOGOLLI VA ..."); read as a
 * sentence. Mostly-capitals rather than all-capitals, because transliteration
 * leaves digraphs mixed: Ч comes through as "Ch" ("IChIMLIKLAR").
 */
export function sentenceCase(text: string): string {
  const letters = text.replace(/[^\p{L}]/gu, '');
  const upper = letters.replace(/[^\p{Lu}]/gu, '').length;
  if (letters.length === 0 || upper / letters.length < 0.8) return text;
  const lower = text.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

export type Reading = {
  /** What is wrong, in one line. */
  what: string;
  /** Why we say so — always something the reader can check. */
  why: string;
  /** What to do next. */
  next: string;
};

/**
 * Plain-language reading of one finding. Only states what the data shows: no
 * legal consequence here (those carry citations elsewhere on the page).
 */
export function readFinding(
  row: SampleCatalogRow,
  finding: SampleCatalogRow['findings'][number],
  codes: Readonly<Record<string, SampleCode>>,
): Reading {
  const own = row.code ? codes[row.code] : undefined;
  const suggestion = finding.suggestedMxik ? codes[finding.suggestedMxik] : undefined;
  // The suggested code is already on screen; say what to do with it, which
  // depends on how sure the system is (same bands as the app).
  const band = finding.confidence === null ? null : bandOf(finding.confidence).key;
  const offer = !suggestion
    ? 'Mos kod topilmadi — kodni qoʻlda tanlash kerak.'
    : band === 'high'
      ? 'Taklifni koʻrib chiqib, tasdiqlang.'
      : band === 'medium'
        ? 'Taklifni tekshiring: tasdiqlang yoki muqobillardan boshqasini tanlang.'
        : 'Ishonch past — kodni qoʻlda tanlang, taklifga tayanmang.';

  switch (finding.type) {
    case 'MISSING':
      return {
        what: 'Qatorda MXIK kodi yoʻq.',
        why: 'Kod ustuni boʻsh.',
        next: offer,
      };
    case 'NOT_FOUND':
      return {
        what: 'Bunday kod tasniflagichda yoʻq.',
        why: row.code && row.code.length !== 17
          ? `Kodda ${row.code.length} ta raqam bor, 17 ta boʻlishi kerak — koʻpincha Excel boshidagi nolni oʻchirgani.`
          : 'Kod 17 xonali, lekin tasniflagichning joriy eksportida topilmadi.',
        next: offer,
      };
    case 'MISMATCH':
      return {
        what: 'Kod haqiqiy, lekin boshqa tovarni bildiradi.',
        why: own ? `Tasniflagichda bu kod: ${own.name}` : 'Kodning tasniflagichdagi nomi tovar nomiga mos kelmadi.',
        next: offer,
      };
    case 'UNIT_CONFLICT':
      return {
        what: 'Kod toʻgʻri, oʻlchov birligi emas.',
        why: `Kod «${finding.requiredUnit ?? '—'}» birligiga qatʼiy bogʻlangan, qatorda «${row.unit ?? '—'}».`,
        next: `Birlikni «${row.unit ?? '—'}» oʻrniga «${finding.requiredUnit ?? '—'}» deb yozing. Kod oʻzgarmaydi.`,
      };
  }
}
