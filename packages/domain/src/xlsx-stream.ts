// The first worksheet of an .xlsx, row by row, without building the workbook in memory (F13).
// ExcelJS's workbook.xlsx.load built every row and cell of every sheet before the row limit could
// apply; here the sheet XML streams through a SAX parser and the caller keeps only what it needs.
// Rows and cells are decoded by ExcelJS's own row and cell parsers (the ones load() runs), with the
// same styles, shared strings and 1904 flag, so values, dates, cached formula results and rich text
// come out as before; merged cells are applied the way load() applied them (only the top-left one
// keeps its value). ExcelJS's public WorkbookReader is not used: it decodes each chunk without
// carrying a split UTF-8 sequence over (Cyrillic broken at chunk edges), ignores merges, reads a
// formula's boolean or error result as a number and parks sheets in temp files when the shared
// strings come after them, as Excel and ExcelJS write them.
import { createRequire } from 'node:module';
import type { Readable } from 'node:stream';
import yauzl, { type Entry, type ZipFile } from 'yauzl';

type SaxNode = { name: string; attributes: Record<string, string> };
type SaxEvent = { eventType: 'opentag'; value: SaxNode } | { eventType: 'text'; value: string } | { eventType: 'closetag'; value: SaxNode };
type CellModel = { address?: string; type: number; value?: unknown; formula?: string; sharedFormula?: string; result?: unknown };
type RowModel = { number: number; cells: CellModel[] };
type RowParser = {
  model: RowModel;
  parseOpen(node: SaxNode): boolean;
  parseText(text: string): void;
  parseClose(name: string): boolean;
  reconcile(model: RowModel, options: object): void;
};
type Parsed<T> = { parseStream(stream: Readable): Promise<T> };
type Range = { top: number; left: number; bottom: number; right: number };

// ExcelJS ships no types for its parsers; these are the members used here (exceljs 4.4.0).
const load = createRequire(import.meta.url);
const parseSax = load('exceljs/lib/utils/parse-sax.js') as (chunks: AsyncIterable<string>) => AsyncIterable<SaxEvent[]>;
const colCache = load('exceljs/lib/utils/col-cache.js') as { decodeAddress(a: string): { row: number; col: number }; decode(ref: string): Range | { row: number; col: number } };
const ValueType = (load('exceljs/lib/doc/enums.js') as { ValueType: Record<'Null' | 'Merge' | 'Formula', number> }).ValueType;
const RowXform = load('exceljs/lib/xlsx/xform/sheet/row-xform.js') as new (options: { maxItems: number }) => RowParser;
const WorkbookXform = load('exceljs/lib/xlsx/xform/book/workbook-xform.js') as new () => Parsed<{ sheets?: { rId?: string }[]; properties?: { date1904?: boolean } }>;
const RelationshipsXform = load('exceljs/lib/xlsx/xform/core/relationships-xform.js') as new () => Parsed<{ Id: string; Target: string }[]>;
const StylesXform = load('exceljs/lib/xlsx/xform/style/styles-xform.js') as new () => Parsed<unknown>;
const SharedStringsXform = load('exceljs/lib/xlsx/xform/strings/shared-strings-xform.js') as new () => Parsed<unknown>;

/** Excel's own column limit: a row with more cells is not a spreadsheet Excel wrote. */
const EXCEL_COLUMNS = 16_384;
/** load() only reads worksheets stored under this name. */
const WORKSHEET = /xl\/worksheets\/sheet(\d+)[.]xml/;

export type XlsxReadErrorCode = 'unreadable' | 'no_sheet' | 'held_limit';

export class XlsxReadError extends Error {
  constructor(readonly code: XlsxReadErrorCode) {
    super(code);
    this.name = 'XlsxReadError';
  }
}

export type SheetReadOptions = {
  /** Cells right of this column are not read; how many held a value is counted. */
  maxColumns: number;
  /** Inflated bytes of the parts held in memory while the sheet streams (workbook, rels, styles, shared strings). */
  maxHeldBytes: number;
};

export type SheetReadResult = { cellsPastColumnLimit: number };

/**
 * Calls `onRow` for every `<row>` of the first worksheet (workbook order, as load() picked
 * `worksheets[0]`), in file order, with the row's values at their column index (a hole where
 * load() had no cell or a merged one): the value is what ExcelJS's `cell.value` was.
 * Throws XlsxReadError.
 */
export async function eachSheetRow(buffer: Buffer, onRow: (rowNumber: number, values: unknown[]) => void, options: SheetReadOptions): Promise<SheetReadResult> {
  let zip: ZipFile;
  let entries: Map<string, Entry>;
  try {
    zip = await openZip(buffer);
    entries = await listEntries(zip);
  } catch {
    throw new XlsxReadError('unreadable');
  }
  const part = (name: string): Entry | undefined => entries.get(name);
  const held = ['xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/sharedStrings.xml'].reduce((n, name) => n + (part(name)?.uncompressedSize ?? 0), 0);
  if (held > options.maxHeldBytes) throw new XlsxReadError('held_limit');

  try {
    const workbookPart = part('xl/workbook.xml');
    const workbook = workbookPart ? await new WorkbookXform().parseStream(await textStream(zip, workbookPart)) : null;
    const relsPart = part('xl/_rels/workbook.xml.rels');
    const rels = relsPart ? await new RelationshipsXform().parseStream(await textStream(zip, relsPart)) : [];
    const target = new Map(rels.map((rel) => [rel.Id, rel.Target]));
    const sheetPath = (workbook?.sheets ?? [])
      .map((sheet) => target.get(sheet.rId ?? ''))
      .map((t) => (t === undefined ? '' : `xl/${t.replace(/^(\s|\/xl\/)+/, '')}`))
      .find((path) => WORKSHEET.test(path) && entries.has(path));
    const sheet = sheetPath ? part(sheetPath) : undefined;
    if (!sheet) throw new XlsxReadError('no_sheet');

    const stylesPart = part('xl/styles.xml');
    const styles = stylesPart ? await parsedInto(new StylesXform(), zip, stylesPart) : undefined;
    const stringsPart = part('xl/sharedStrings.xml');
    const sharedStrings = stringsPart ? await parsedInto(new SharedStringsXform(), zip, stringsPart) : undefined;
    const reconcileOptions = { styles, sharedStrings, date1904: workbook?.properties?.date1904, formulae: {}, hyperlinkMap: {}, commentsMap: {} };

    // Merges sit after the rows in the sheet XML: read them first so each row is final when it is handed over.
    const merges = new Merges(await mergeRefs(zip, sheet), options.maxColumns);
    let cellsPastColumnLimit = 0;
    const row = new RowXform({ maxItems: EXCEL_COLUMNS });
    let inSheetData = false;
    let inRow = false;
    const finish = (model: RowModel): void => {
      row.reconcile(model, reconcileOptions);
      const values: unknown[] = [];
      let previous: number | undefined;
      for (const cell of model.cells) {
        // load() leaves out a cell with neither value nor style, and does not move the column on.
        if (cell.type === ValueType.Merge) continue;
        // A cell without an address is the one right of the previous (load() then failed on the first one).
        const col = cell.address ? colCache.decodeAddress(cell.address).col : (previous ?? 0) + 1;
        previous = col;
        if (cell.type === ValueType.Null) continue;
        if (col > options.maxColumns) {
          if (typeof cell.value !== 'string' || cell.value.trim() !== '') cellsPastColumnLimit++;
          continue;
        }
        values[col - 1] = cell.type === ValueType.Formula ? { formula: cell.formula ?? cell.sharedFormula, result: cell.result } : cell.value;
      }
      merges.clear(model.number, values);
      // load() never had the merged cells at the end of the row: the row ends at its last kept cell.
      while (values.length > 0 && !(values.length - 1 in values)) values.length--;
      onRow(model.number, values);
    };
    // A sheet cut short (its root never closed) is a damaged file, as load() found it.
    let depth = 0;
    let opened = false;
    for await (const events of parseSax(await textStream(zip, sheet))) {
      for (const event of events) {
        if (event.eventType === 'opentag') { depth++; opened = true; } else if (event.eventType === 'closetag') depth--;
        if (inRow) {
          if (event.eventType === 'opentag') row.parseOpen(event.value);
          else if (event.eventType === 'text') row.parseText(event.value);
          else if (!row.parseClose(event.value.name)) { inRow = false; finish(row.model); }
        } else if (event.eventType === 'opentag') {
          if (event.value.name === 'sheetData') inSheetData = true;
          else if (event.value.name === 'row' && inSheetData) { row.parseOpen(event.value); inRow = true; }
        } else if (event.eventType === 'closetag' && event.value.name === 'sheetData') {
          inSheetData = false;
        }
      }
    }
    if (!opened || depth !== 0) throw new XlsxReadError('unreadable');
    return { cellsPastColumnLimit };
  } catch (error) {
    throw error instanceof XlsxReadError ? error : new XlsxReadError('unreadable');
  }
}

/** Merged ranges whose top-left cell is inside the read columns; finds those covering a row, rows in rising order. */
class Merges {
  private readonly byTop: Range[];
  private next = 0;
  private active: Range[] = [];
  private lastRow = 0;

  constructor(refs: readonly string[], private readonly maxColumns: number) {
    const ranges: Range[] = [];
    for (const ref of refs) {
      const range = decodeRange(ref);
      if (range && range.left <= maxColumns && (range.bottom > range.top || range.right > range.left)) ranges.push(range);
    }
    this.byTop = ranges.sort((a, b) => a.top - b.top);
  }

  /** Empties every merged cell of the row but the top-left one of its range, as load() did. */
  clear(rowNumber: number, values: unknown[]): void {
    if (this.byTop.length === 0) return;
    if (rowNumber < this.lastRow) { this.next = 0; this.active = []; }
    this.lastRow = rowNumber;
    while (this.next < this.byTop.length && (this.byTop[this.next]?.top ?? Infinity) <= rowNumber) this.active.push(this.byTop[this.next++] as Range);
    this.active = this.active.filter((m) => m.bottom >= rowNumber);
    // Ranges load() accepted never overlap, so no more than one per read column covers a row.
    if (this.active.length > this.maxColumns) throw new XlsxReadError('unreadable');
    for (const m of this.active) {
      for (let col = m.left; col <= Math.min(m.right, this.maxColumns); col++) {
        if (rowNumber > m.top || col > m.left) Reflect.deleteProperty(values, col - 1); // a hole, as load() had no cell there
      }
    }
  }
}

function decodeRange(ref: string): Range | null {
  try {
    const decoded = colCache.decode(ref);
    return 'top' in decoded ? decoded : { top: decoded.row, left: decoded.col, bottom: decoded.row, right: decoded.col };
  } catch {
    return null;
  }
}

/** `<mergeCell ref="…">` of a sheet, by a scan of its text (cell text cannot hold a raw `<`). */
async function mergeRefs(zip: ZipFile, sheet: Entry): Promise<string[]> {
  const refs: string[] = [];
  const pattern = /<mergeCell\b[^>]*?\bref\s*=\s*["']([^"']+)["']/g;
  let tail = '';
  for await (const chunk of await textStream(zip, sheet)) {
    const text = tail + (chunk as string);
    for (const match of text.matchAll(pattern)) {
      // A match inside the carried tail was found with the previous chunk.
      if ((match.index ?? 0) + match[0].length > tail.length && match[1]) refs.push(match[1]);
    }
    tail = text.slice(-512);
  }
  return refs;
}

async function parsedInto<T extends Parsed<unknown>>(xform: T, zip: ZipFile, entry: Entry): Promise<T> {
  await xform.parseStream(await textStream(zip, entry));
  return xform;
}

function openZip(buffer: Buffer): Promise<ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true, validateEntrySizes: true }, (error, zip) => (error ? reject(error) : resolve(zip)));
  });
}

/** Every file of the archive by name (a leading `/` dropped and the last of a repeated name kept, as load() read them). */
function listEntries(zip: ZipFile): Promise<Map<string, Entry>> {
  return new Promise((resolve, reject) => {
    const entries = new Map<string, Entry>();
    zip.on('entry', (entry: Entry) => {
      if (!entry.fileName.endsWith('/')) entries.set(entry.fileName.replace(/^\//, ''), entry);
      zip.readEntry();
    });
    zip.on('end', () => resolve(entries));
    zip.on('error', reject);
    zip.readEntry();
  });
}

/** An entry inflated as UTF-8 text; the decoder carries a character split between chunks over. */
function textStream(zip: ZipFile, entry: Entry): Promise<Readable> {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (error, stream) => {
      if (error) {
        reject(error);
        return;
      }
      stream.setEncoding('utf8');
      resolve(stream);
    });
  });
}
