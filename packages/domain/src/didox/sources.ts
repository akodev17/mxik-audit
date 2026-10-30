// The file sources of a Didox invoice (the fallback that works without API access):
//   - the user's Didox zip export (RESEARCH.md §4.1, §7.14): a single-document zip (`<DOCID>.json`,
//     `<DOCID>.pdf`, readme.txt, optional .p7s; the real sample in fixtures/) or the profile's
//     "zip of zips"; the archive is walked for `*.json` entries that parse as documents, nested zips
//     one level deep, every archive through zip-guard first and all of them against one entry and
//     inflation budget (Phase C F6);
//   - a single document JSON (any envelope document.ts reads), or an array of them;
//   - an XLSX: Didox's own «ЭСФ» Excel template is read as a fixed preset (column numbers from the
//     official filling instruction, docs/accounting-2026-10-23/reference/
//     didox-excel-templates-instruction-2026-10-28.txt: header fields per invoice in columns 1–40,
//     lines in AO–BH, one template may hold several invoices); any other sheet has its columns
//     guessed from header words, the user confirms them, and the confirmed mapping is remembered per
//     org by the header signature (the bank module's BankFormat pattern, service.ts). The template
//     preset is verified: false: built from the instruction text, no filled template xlsx was at hand.
import JSZip from 'jszip';
import { z } from 'zod';
import { looksLikeZip, ZIP_LIMITS, zipUsage, zipWithinLimits, type ZipLimits } from '../security/zip-guard.js';
import { parseErrorCode, parseUpload, type ParseResult } from '../spreadsheet.js';
import { parseDidoxJson, unwrap, type DidoxKind } from './document.js';

/** One document JSON found in an upload, with the print form when the archive carried one beside it. */
export type FoundDocument = { entry: string; json: unknown; kind: DidoxKind; pdf: Buffer | null };
export type SkippedEntry = { entry: string; reason: 'not_json' | 'unreadable_json' | 'not_document' | 'nested_too_deep' | 'zip_limits' | 'too_many_documents' };

export type UploadRead =
  | { kind: 'documents'; documents: FoundDocument[]; skipped: SkippedEntry[] }
  | { kind: 'xlsx'; sheet: ParseResult }
  | { kind: 'error'; error: 'zip_limits' | 'unreadable' | 'empty' | 'unsupported' | 'legacy_xls' | 'no_documents' };

/** Archive depth: the export zip (1) holding one zip per document (2). */
const MAX_DEPTH = 2;
const MAX_DOCUMENTS = 500;

/** What the whole walk may still inflate, across every nesting level: one budget per upload, not one per archive. */
type Budget = { entries: number; bytes: number };
class OverBudget extends Error {}

const isXlsxArchive = (zip: JSZip): boolean => zip.file('[Content_Types].xml') !== null && Object.keys(zip.files).some((n) => n.startsWith('xl/'));

/** Every JSON of an upload goes through parseDidoxJson: 17-digit codes never pass through a JS number. */
function parseJson(buffer: Buffer): unknown {
  return parseDidoxJson(buffer.toString('utf8'));
}

const stem = (name: string): string => name.replace(/\.[^./]+$/, '').toLowerCase();
const folder = (name: string): string => (name.includes('/') ? name.slice(0, name.lastIndexOf('/')) : '');

async function walk(buffer: Buffer, prefix: string, depth: number, out: { documents: FoundDocument[]; skipped: SkippedEntry[] }, budget: Budget): Promise<void> {
  const usage = await zipUsage(buffer, { maxEntries: budget.entries, maxTotalBytes: budget.bytes });
  if (usage === 'over') throw new OverBudget();
  if (usage === null) {
    out.skipped.push({ entry: prefix || '(archive)', reason: 'zip_limits' });
    return;
  }
  budget.entries -= usage.entries;
  budget.bytes -= usage.bytes;
  const zip = await JSZip.loadAsync(buffer);
  const entries = Object.values(zip.files).filter((f) => !f.dir && !f.name.startsWith('__MACOSX/'));
  const pdfs = new Map<string, JSZip.JSZipObject>();
  for (const e of entries) if (/\.pdf$/i.test(e.name)) pdfs.set(e.name, e);

  for (const e of entries) {
    const name = `${prefix}${e.name}`;
    if (/\.zip$/i.test(e.name)) {
      if (depth >= MAX_DEPTH) { out.skipped.push({ entry: name, reason: 'nested_too_deep' }); continue; }
      await walk(await e.async('nodebuffer'), `${name}/`, depth + 1, out, budget);
      continue;
    }
    if (!/\.json$/i.test(e.name)) {
      if (!/\.(pdf|p7s|txt|md|sig)$/i.test(e.name)) out.skipped.push({ entry: name, reason: 'not_json' });
      continue;
    }
    // Past the cap a document is listed as skipped, never cut silently (review 30 Oct: 600 gave 500 and "0 skipped").
    if (out.documents.length >= MAX_DOCUMENTS) { out.skipped.push({ entry: name, reason: 'too_many_documents' }); continue; }
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

/** Reads an upload by content: a Didox archive, one document JSON, or an ЭСФ spreadsheet. `limits` is what the archive and every archive inside it may inflate together. */
export async function readDidoxUpload(buffer: Buffer, filename: string, limits: ZipLimits = ZIP_LIMITS): Promise<UploadRead> {
  if (buffer.length === 0) return { kind: 'error', error: 'empty' };
  if (looksLikeZip(buffer)) {
    if (!(await zipWithinLimits(buffer, limits))) return { kind: 'error', error: 'zip_limits' };
    let zip: JSZip;
    try { zip = await JSZip.loadAsync(buffer); } catch { return { kind: 'error', error: 'unreadable' }; }
    if (isXlsxArchive(zip)) return readSheet(buffer, filename);
    const out = { documents: [] as FoundDocument[], skipped: [] as SkippedEntry[] };
    try {
      await walk(buffer, '', 1, out, { entries: limits.maxEntries, bytes: limits.maxTotalBytes });
    } catch (error) {
      return { kind: 'error', error: error instanceof OverBudget ? 'zip_limits' : 'unreadable' };
    }
    if (out.documents.length === 0) return { kind: 'error', error: 'no_documents' };
    return { kind: 'documents', ...out };
  }
  const head = buffer.subarray(0, 64).toString('utf8').replace(/^\uFEFF/, '').trimStart();
  if (head.startsWith('{') || head.startsWith('[')) {
    let json: unknown;
    try { json = parseJson(buffer); } catch { return { kind: 'error', error: 'unreadable' }; }
    // A JSON array of documents (an export of several) is accepted too.
    const items = Array.isArray(json) ? json : [json];
    const documents: FoundDocument[] = [];
    const skipped: SkippedEntry[] = [];
    items.forEach((item, i) => {
      const entry = items.length > 1 ? `${filename}[${i}]` : filename;
      if (i >= MAX_DOCUMENTS) { skipped.push({ entry, reason: 'too_many_documents' }); return; }
      const { kind } = unwrap(item);
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

/** A header signature: the folded header names in column order, placeholder letters blank (the bank module's headerSignature). */
export function sheetSignature(headers: readonly string[]): string {
  return headers
    .map((h) => h.toLowerCase().replace(/[\s\u00a0]+/g, ' ').replace(/[^\p{L}\p{N}% ]/gu, '').trim())
    .map((k) => (/^[a-z]{1,3}$/.test(k) ? '' : k))
    .join('|').replace(/\|+$/, '').slice(0, 2000);
}

// ── The official ЭСФ Excel template (fixed preset) ───────────────────────────────────────────

/** Column numbers of the Didox ЭСФ template, 1-based as the filling instruction counts them. */
export const ESF_TEMPLATE_COLUMNS = {
  invoice: 1, facturaType: 2, singleSidedType: 3, facturaNo: 4, facturaDate: 5, contractNo: 6, contractDate: 7,
  sellerTin: 14, buyerTin: 28,
  lineNo: 41, name: 45, mxik: 46, barcode: 47, serial: 48, packageCode: 49, baseSumma: 50, profitRate: 51,
  quantity: 52, price: 53, exciseRate: 54, exciseSum: 55, amount: 56, vatRate: 57, vatAmount: 58, total: 59, lgota: 60,
  origin: 65, contractId: 66, lotId: 70, oldFacturaId: 72, dispenseType: 73,
} as const;
type TemplateField = keyof typeof ESF_TEMPLATE_COLUMNS;

/** The template's line columns run to BH (60); its header block to AN (40). */
export const ESF_TEMPLATE_MIN_COLUMNS = 59;

const at = (row: readonly string[], field: TemplateField): string => (row[ESF_TEMPLATE_COLUMNS[field] - 1] ?? '').trim();
const numeric = (v: string): boolean => /^-?[\d\s\u00a0]+([.,]\d+)?$/.test(v.trim());

/**
 * The sheet is Didox's ЭСФ template: at least 59 columns, and either the ИКПУ column's header names
 * it, or the line rows carry a name in AS (45) with a 16–17 digit code in AT (46) and a number in
 * AZ (52). Returns the rows that are invoice lines.
 */
export function esfTemplateRows(sheet: Pick<ParseResult, 'headers' | 'rows'>): string[][] | null {
  if (sheet.headers.length < ESF_TEMPLATE_MIN_COLUMNS) return null;
  const lines = sheet.rows.filter((r) => at(r, 'name') !== '' && (numeric(at(r, 'quantity')) || numeric(at(r, 'amount'))) && !TOTAL_ROW.test(at(r, 'name')));
  if (lines.length === 0) return null;
  const headerSaysIkpu = /икпу|ikpu|mxik|мхик|каталог/i.test(sheet.headers[ESF_TEMPLATE_COLUMNS.mxik - 1] ?? '');
  const coded = lines.filter((r) => /^\d{16,17}$/.test(at(r, 'mxik').replace(/\s/g, ''))).length;
  return headerSaysIkpu || coded * 2 >= lines.length ? lines : null;
}

/** A date cell written as text (`30.06.2025`, `2025-06-30`) or left as an Excel serial by a sheet that was not in text format. */
function templateDate(value: string): string | undefined {
  const v = value.trim();
  if (!v) return undefined;
  if (/^\d{5}$/.test(v) && Number(v) > 30_000 && Number(v) < 80_000) return new Date(Date.UTC(1899, 11, 30) + Number(v) * 86_400_000).toISOString().slice(0, 10);
  return v;
}

/** The seller's or buyer's name column within its block, by header word (the instruction names only the ИНН columns). */
function nameColumn(headers: readonly string[], from: number, to: number): number {
  for (let i = from - 1; i < to; i++) if (/наимен|nomi|nomlanish|name/i.test(headers[i] ?? '')) return i;
  return -1;
}

export type TemplateInvoice = { document: Record<string, unknown>; firstRow: number; lines: number };

/**
 * The template's invoices as Didox lowercase documents, one per run of lines: a row with a value in
 * column A (or a new invoice number in D) starts the next invoice, as the instruction says ("п.п. в
 * колонке А достаточно указать в первой позиции").
 */
export function templateToDocuments(sheet: Pick<ParseResult, 'headers' | 'rows'>): TemplateInvoice[] {
  const lines = esfTemplateRows(sheet);
  if (!lines) return [];
  const sellerName = nameColumn(sheet.headers, 13, 26);
  const buyerName = nameColumn(sheet.headers, 27, 40);
  const out: TemplateInvoice[] = [];
  let head: string[] | null = null;
  let products: Array<Record<string, unknown>> = [];
  const flush = (): void => {
    if (!head || products.length === 0) return;
    const h = head;
    const cell = (f: TemplateField): string | undefined => at(h, f) || undefined;
    const old = cell('oldFacturaId');
    out.push({
      firstRow: sheet.rows.indexOf(h),
      lines: products.length,
      document: {
        facturatype: cell('facturaType') ?? '0',
        singlesidedtype: cell('singleSidedType') ?? null,
        facturadoc: { facturano: cell('facturaNo'), facturadate: templateDate(at(h, 'facturaDate')) },
        contractdoc: { contractno: cell('contractNo') ?? null, contractdate: templateDate(at(h, 'contractDate')) ?? null },
        oldfacturadoc: old ? { oldfacturaid: old } : null,
        contractid: cell('contractId') ?? null,
        lotid: cell('lotId') ?? '',
        sellertin: cell('sellerTin'),
        seller: { name: sellerName >= 0 ? h[sellerName]?.trim() ?? '' : '' },
        buyertin: cell('buyerTin') ?? '',
        buyer: cell('buyerTin') ? { name: buyerName >= 0 ? h[buyerName]?.trim() ?? '' : '' } : null,
        productlist: { hasmedical: products.some((p) => p['serial']), products },
      },
    });
  };
  for (const row of lines) {
    const startsInvoice = head === null || at(row, 'invoice') !== '' || (at(row, 'facturaNo') !== '' && at(row, 'facturaNo') !== at(head, 'facturaNo'));
    if (startsInvoice) { flush(); head = row; products = []; }
    const cell = (f: TemplateField): string | undefined => at(row, f) || undefined;
    const rate = cell('vatRate');
    const withoutVat = rate !== undefined && /без|qqssiz|ққс\s*сиз/i.test(rate);
    products.push({
      ordno: cell('lineNo') ?? products.length + 1,
      name: cell('name'),
      catalogcode: cell('mxik')?.replace(/\s/g, ''),
      barcode: cell('barcode'),
      packagecode: cell('packageCode'),
      count: cell('quantity') ?? '1',
      summa: cell('price'),
      exciserate: cell('exciseRate'), excisesum: cell('exciseSum'),
      deliverysum: cell('amount'),
      vatrate: withoutVat ? undefined : rate?.replace('%', ''),
      withoutvat: withoutVat,
      vatsum: cell('vatAmount'),
      deliverysumwithvat: cell('total'),
      lgotaid: cell('lgota') ?? null,
      origin: cell('origin'),
      ...(cell('serial') ? { serial: cell('serial'), basesumma: cell('baseSumma'), profitrate: cell('profitRate'), dispensetype: cell('dispenseType') } : {}),
    });
  }
  flush();
  return out;
}
