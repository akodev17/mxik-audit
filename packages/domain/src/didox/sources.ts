// The file sources of a Didox invoice (the fallback that works without API access):
//   - the user's Didox zip export: "a zip of zips: per document a JSON, a PDF, .p7s signatures and
//     a readme" (research note §1; the internal naming is [UNKNOWN]), so the archive is walked for
//     `*.json` entries that parse as documents, nested zips one level deep, every archive through
//     zip-guard first;
//   - a single document JSON;
//   - an XLSX in Didox's own «ЭСФ» Excel template. The official instruction channel publishes the
//     template but its exact layout was not read (research note §1), so the columns are guessed
//     from header words and the user confirms them, like the catalogue wizard. verified: false.
import JSZip from 'jszip';
import { z } from 'zod';
import { looksLikeZip, zipWithinLimits } from '../security/zip-guard.js';
import { parseErrorCode, parseUpload, type ParseResult } from '../spreadsheet.js';
import { unwrap, type DidoxKind } from './document.js';

/** One document JSON found in an upload, with the print form when the archive carried one beside it. */
export type FoundDocument = { entry: string; json: unknown; kind: DidoxKind; pdf: Buffer | null };
export type SkippedEntry = { entry: string; reason: 'not_json' | 'unreadable_json' | 'not_document' | 'nested_too_deep' | 'zip_limits' };

export type UploadRead =
  | { kind: 'documents'; documents: FoundDocument[]; skipped: SkippedEntry[] }
  | { kind: 'xlsx'; sheet: ParseResult }
  | { kind: 'error'; error: 'zip_limits' | 'unreadable' | 'empty' | 'unsupported' | 'legacy_xls' | 'no_documents' };

/** Archive depth: the export zip (1) holding one zip per document (2). */
const MAX_DEPTH = 2;
const MAX_DOCUMENTS = 500;

const isXlsxArchive = (zip: JSZip): boolean => zip.file('[Content_Types].xml') !== null && Object.keys(zip.files).some((n) => n.startsWith('xl/'));

function parseJson(buffer: Buffer): unknown {
  return JSON.parse(buffer.toString('utf8').replace(/^﻿/, ''));
}

const stem = (name: string): string => name.replace(/\.[^./]+$/, '').toLowerCase();
const folder = (name: string): string => (name.includes('/') ? name.slice(0, name.lastIndexOf('/')) : '');

async function walk(buffer: Buffer, prefix: string, depth: number, out: { documents: FoundDocument[]; skipped: SkippedEntry[] }): Promise<void> {
  if (!(await zipWithinLimits(buffer))) {
    out.skipped.push({ entry: prefix || '(archive)', reason: 'zip_limits' });
    return;
  }
  const zip = await JSZip.loadAsync(buffer);
  const entries = Object.values(zip.files).filter((f) => !f.dir && !f.name.startsWith('__MACOSX/'));
  const pdfs = new Map<string, JSZip.JSZipObject>();
  for (const e of entries) if (/\.pdf$/i.test(e.name)) pdfs.set(e.name, e);

  for (const e of entries) {
    const name = `${prefix}${e.name}`;
    if (/\.zip$/i.test(e.name)) {
      if (depth >= MAX_DEPTH) { out.skipped.push({ entry: name, reason: 'nested_too_deep' }); continue; }
      await walk(await e.async('nodebuffer'), `${name}/`, depth + 1, out);
      continue;
    }
    if (!/\.json$/i.test(e.name)) {
      if (!/\.(pdf|p7s|txt|md|sig)$/i.test(e.name)) out.skipped.push({ entry: name, reason: 'not_json' });
      continue;
    }
    if (out.documents.length >= MAX_DOCUMENTS) break;
    let json: unknown;
    try {
      json = parseJson(await e.async('nodebuffer'));
    } catch {
      out.skipped.push({ entry: name, reason: 'unreadable_json' });
      continue;
    }
    const { kind } = unwrap(json);
    if (kind === 'unknown') { out.skipped.push({ entry: name, reason: 'not_document' }); continue; }
    // The print form: a PDF with the same stem, else the only PDF in the same folder.
    const sameFolder = [...pdfs.values()].filter((p) => folder(p.name) === folder(e.name));
    const pdf = sameFolder.find((p) => stem(p.name) === stem(e.name)) ?? (sameFolder.length === 1 ? sameFolder[0] : undefined);
    out.documents.push({ entry: name, json, kind, pdf: pdf ? await pdf.async('nodebuffer') : null });
  }
}

/** Reads an upload by content: a Didox archive, one document JSON, or an ЭСФ spreadsheet. */
export async function readDidoxUpload(buffer: Buffer, filename: string): Promise<UploadRead> {
  if (buffer.length === 0) return { kind: 'error', error: 'empty' };
  if (looksLikeZip(buffer)) {
    if (!(await zipWithinLimits(buffer))) return { kind: 'error', error: 'zip_limits' };
    let zip: JSZip;
    try { zip = await JSZip.loadAsync(buffer); } catch { return { kind: 'error', error: 'unreadable' }; }
    if (isXlsxArchive(zip)) return readSheet(buffer, filename);
    const out = { documents: [] as FoundDocument[], skipped: [] as SkippedEntry[] };
    try { await walk(buffer, '', 1, out); } catch { return { kind: 'error', error: 'unreadable' }; }
    if (out.documents.length === 0) return { kind: 'error', error: 'no_documents' };
    return { kind: 'documents', ...out };
  }
  const head = buffer.subarray(0, 64).toString('utf8').replace(/^﻿/, '').trimStart();
  if (head.startsWith('{') || head.startsWith('[')) {
    let json: unknown;
    try { json = parseJson(buffer); } catch { return { kind: 'error', error: 'unreadable' }; }
    // A JSON array of documents (an export of several) is accepted too.
    const items = Array.isArray(json) ? json : [json];
    const documents: FoundDocument[] = [];
    const skipped: SkippedEntry[] = [];
    items.slice(0, MAX_DOCUMENTS).forEach((item, i) => {
      const { kind } = unwrap(item);
      const entry = items.length > 1 ? `${filename}[${i}]` : filename;
      if (kind === 'unknown') skipped.push({ entry, reason: 'not_document' });
      else documents.push({ entry, json: item, kind, pdf: null });
    });
    if (documents.length === 0) return { kind: 'error', error: 'no_documents' };
    return { kind: 'documents', documents, skipped };
  }
  if (/\.(xlsx|xls|csv)$/i.test(filename)) return readSheet(buffer, filename);
  return { kind: 'error', error: 'unsupported' };
}

async function readSheet(buffer: Buffer, filename: string): Promise<UploadRead> {
  try {
    const sheet = await parseUpload(buffer, filename);
    if (sheet.rows.length === 0) return { kind: 'error', error: 'empty' };
    return { kind: 'xlsx', sheet };
  } catch (error) {
    const code = parseErrorCode(error);
    return { kind: 'error', error: code === 'legacy_xls' ? 'legacy_xls' : code === 'zip_limits' ? 'zip_limits' : 'unreadable' };
  }
}

// ── The ЭСФ spreadsheet: column mapping and header fields ────────────────────────────────────

export const SHEET_FIELDS = ['lineNo', 'name', 'mxik', 'barcode', 'packageName', 'quantity', 'price', 'amount', 'vatRate', 'vatAmount', 'total'] as const;
export type SheetField = (typeof SHEET_FIELDS)[number];
/** Column index per field; -1 = not in the file. */
export type SheetMap = Record<SheetField, number>;
export const SheetMapSchema = z.object(Object.fromEntries(SHEET_FIELDS.map((f) => [f, z.number().int().min(-1).max(500)])) as Record<SheetField, z.ZodNumber>);

/** The invoice header the user types, since a lines table does not carry it. */
export const SheetHeaderSchema = z.object({
  number: z.string().trim().min(1).max(60),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  sellerTin: z.string().regex(/^(\d{9}|\d{14})$/),
  sellerName: z.string().trim().min(1).max(300),
  buyerTin: z.string().regex(/^(\d{9}|\d{14})$/).optional().or(z.literal('')),
  contractNumber: z.string().trim().max(60).optional(),
  contractDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('')),
});
export type SheetHeader = z.infer<typeof SheetHeaderSchema>;

/**
 * Header words per field, most specific first: "Стоимость поставки с учетом НДС" is the total, not
 * the amount, so the with-VAT rule runs before the amount rule. Russian, Uzbek Latin and Cyrillic.
 */
const SHEET_RULES: Array<[SheetField, RegExp]> = [
  ['total', /с\s*уч[её]том\s*ндс|с\s*ндс|qqs\s*bilan|qqsni\s*hisobga|ққс\s*билан|всего|jami|жами/u],
  ['vatAmount', /сумма\s*ндс|ндс.*сумма|qqs\s*summa|qqs\s*miqdor|ққс\s*сумма/u],
  ['vatRate', /ставка|stavka|ндс.*%|qqs.*%|%/u],
  ['amount', /стоимость\s*поставки|yetkazib\s*berish\s*qiymat|без\s*ндс|qqssiz|сумма/u],
  ['price', /цена|narx|нарх/u],
  ['quantity', /кол|miqdor|soni|миқдор|сони/u],
  ['mxik', /икпу|mxik|ikpu|мхик|каталог|identifikatsiya|идентификац/u],
  ['barcode', /штрих|shtrix|barcode|gtin/u],
  ['packageName', /упаков|qadoq|қадоқ|ед\.|единиц|изм|o.?lchov|birlik|ўлчов|бирлик/u],
  ['name', /наимен|nomi|nomlanish|номи|товар|mahsulot|маҳсулот|xizmat|услуг/u],
  ['lineNo', /^(№|n|no|т\/р|п\/п|t\/r|#)$/u],
];

export function guessSheetMap(headers: readonly string[]): SheetMap {
  const map = Object.fromEntries(SHEET_FIELDS.map((f) => [f, -1])) as SheetMap;
  const taken = new Set<number>();
  for (const [field, rule] of SHEET_RULES) {
    const i = headers.findIndex((h, idx) => !taken.has(idx) && rule.test(h.toLowerCase().trim()));
    if (i >= 0 && map[field] < 0) { map[field] = i; taken.add(i); }
  }
  return map;
}

/** Rows that are totals or blank, not lines. */
// `\b` is ASCII-only in JavaScript, so the word end is spelled out for Cyrillic.
const TOTAL_ROW = /^(итого|всего|jami|жами|total)(?:$|[^\p{L}])/iu;

/** Builds a document in Didox's lower-case shape from the sheet, so it runs through the same parser. */
export function sheetToDocument(sheet: Pick<ParseResult, 'rows'>, map: SheetMap, header: SheetHeader): Record<string, unknown> {
  const cell = (row: string[], field: SheetField): string | undefined => (map[field] >= 0 ? row[map[field]]?.trim() || undefined : undefined);
  const products = sheet.rows
    .filter((row) => {
      const name = cell(row, 'name');
      return name !== undefined && !TOTAL_ROW.test(name) && (cell(row, 'quantity') !== undefined || cell(row, 'amount') !== undefined);
    })
    .map((row, i) => ({
      ordno: cell(row, 'lineNo') ?? i + 1,
      name: cell(row, 'name'),
      catalogcode: cell(row, 'mxik'),
      barcode: cell(row, 'barcode'),
      packagename: cell(row, 'packageName'),
      count: cell(row, 'quantity') ?? '1',
      summa: cell(row, 'price'),
      deliverysum: cell(row, 'amount'),
      vatrate: cell(row, 'vatRate')?.replace('%', ''),
      vatsum: cell(row, 'vatAmount'),
      deliverysumwithvat: cell(row, 'total'),
    }));
  return {
    facturadoc: { facturano: header.number, facturadate: header.date },
    contractdoc: { contractno: header.contractNumber || null, contractdate: header.contractDate || null },
    sellertin: header.sellerTin,
    seller: { name: header.sellerName },
    buyertin: header.buyerTin || null,
    productlist: { products },
  };
}
