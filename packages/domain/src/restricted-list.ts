// The official list of generalized MXIK codes EHF refuses from a date on
// (construction resources, tasnif.soliq.uz news 5063), as published in
// perechen.xlsx: a title block, the header on row 4 (№, МХИК коди, name in
// Latin, Cyrillic and Russian) and the data from row 5. Pure; the loader is
// scripts/load-restricted.ts.
import type ExcelJS from 'exceljs';

/** Where the restriction was announced; stored with every row. */
export const RESTRICTED_SOURCE_URL = 'https://tasnif.soliq.uz/news/5063';
/** The first stage's date, from the list's own title. */
export const RESTRICTED_DEFAULT_FROM = '2026-07-01';

export type RestrictedEntry = { code: string; name: string };

export type ParsedRestrictedList = {
  entries: RestrictedEntry[];
  /** Data rows whose code cell is not a 17-digit code, by 1-based row number. */
  skipped: { row: number; value: string }[];
  /** Codes listed more than once; each is kept once. */
  duplicates: string[];
};

const HEADER_ROW = 4;
const CODE_HEADER = /^(МХИК|MXIK|ИКПУ|IKPU)\s*(коди|kodi|код|kod)?$/i;
const HEADER_SCAN = 20;

/** A cell as plain text: rich text joined, numbers as written. */
export function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    if ('richText' in value) return value.richText.map((r) => r.text).join('').trim();
    if ('text' in value && typeof value.text === 'string') return value.text.trim();
    if ('result' in value && value.result !== undefined) return cellText(value.result);
    return '';
  }
  return String(value).trim();
}

/** The header row and the code column: the cell titled "МХИК коди", else row 4 column B. */
function locateHeader(sheet: ExcelJS.Worksheet): { row: number; codeCol: number } {
  for (let r = 1; r <= Math.min(sheet.rowCount, HEADER_SCAN); r++) {
    const row = sheet.getRow(r);
    for (let c = 1; c <= row.cellCount; c++) {
      if (CODE_HEADER.test(cellText(row.getCell(c).value))) return { row: r, codeCol: c };
    }
  }
  return { row: HEADER_ROW, codeCol: 2 };
}

/**
 * Reads the list. The three name columns follow the code column (Latin,
 * Cyrillic, Russian); the stored name is the Russian one, else the Uzbek.
 * Empty rows are ignored; anything else without a 17-digit code is reported.
 */
export function parseRestrictedSheet(sheet: ExcelJS.Worksheet): ParsedRestrictedList {
  const { row: headerRow, codeCol } = locateHeader(sheet);
  const entries: RestrictedEntry[] = [];
  const skipped: ParsedRestrictedList['skipped'] = [];
  const seen = new Set<string>();
  const duplicates: string[] = [];
  for (let r = headerRow + 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const raw = cellText(row.getCell(codeCol).value);
    const [latin = '', cyrillic = '', russian = ''] = [1, 2, 3].map((d) => cellText(row.getCell(codeCol + d).value));
    if (!raw && !latin && !cyrillic && !russian) continue;
    const code = raw.replace(/\s/g, '');
    if (!/^\d{17}$/.test(code)) {
      skipped.push({ row: r, value: raw });
      continue;
    }
    if (seen.has(code)) {
      duplicates.push(code);
      continue;
    }
    seen.add(code);
    entries.push({ code, name: russian || cyrillic || latin });
  }
  return { entries, skipped, duplicates };
}
