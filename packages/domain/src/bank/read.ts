// An uploaded statement file → its table, its layout (a built-in one, the org's saved one, or a
// guess for the mapping step) and its fingerprint. Server-only (the xlsx reader).
//
// What is read, by content and never by name (B2, bank research §7): .xlsx; legacy .xls (BIFF8,
// xls.ts) and the HTML / Excel-2003-XML files saved as .xls (markup.ts); text in UTF-8 (BOM or not),
// windows-1251 or DOS cp866, split on ';' ',' tab '|' '~' or by fixed width (text.ts); a zip around
// any of these (ASBT hands every report out zipped, §2.2); and a bank's own kl_to_1c.txt
// (1CClientBankExchange, documents.ts). A PDF is refused with its own message (§7.41).
import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import type { BankColumnMap, BankConventions } from '@tasnivo/contracts/modules/bank';
import { isBankExchange, parseBankExchange, type ExchangeWarning } from '../onec/bank-exchange.js';
import { looksLikeZip, zipWithinLimits } from '../security/zip-guard.js';
import { parseErrorCode, readGrid, sniffKind, type ParseErrorCode } from '../spreadsheet.js';
import { decodeCyrillic, looksBinary } from '../spreadsheet-text.js';
import { exchangeStatement, payerPayeeColumns, payerPayeeStatement, type SectionWarning } from './documents.js';
import { detectFormat, guessMapping, headerSignature, layoutFor, type BankFormatDef } from './formats/index.js';
import { htmlGrid, markupKind, spreadsheetMlGrid } from './markup.js';
import { parseStatement, type ParsedStatement } from './parse.js';
import { locateTable, readTitle, type StatementSheet } from './sheet.js';
import { readStatementText } from './text.js';
import { readXls, XlsError } from './xls.js';

/** SHA-256 of the file's bytes: the same file uploaded twice is refused as a duplicate statement. */
export const fileFingerprint = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

/** Why a statement file cannot be read: the spreadsheet reader's reasons plus the bank's own. */
export type StatementReadCode = ParseErrorCode | 'pdf' | 'archive_empty' | 'archive_many' | 'xls_encrypted' | 'xls_old';

export class StatementReadError extends Error {
  constructor(readonly code: StatementReadCode) {
    super(code);
    this.name = 'StatementReadError';
  }
}

export const statementReadCode = (error: unknown): StatementReadCode => (error instanceof StatementReadError ? error.code : parseErrorCode(error));

/** How the file was read, kept with the statement so a wrong reading can be explained. */
export type StatementSource = {
  kind: 'xlsx' | 'xls' | 'html' | 'spreadsheetml' | 'text' | 'exchange';
  encoding: string | null;
  delimiter: string | null;
  fixedWidth: boolean;
  /** The file's name inside the zip it came in, if it came in one. */
  archived: string | null;
};

/** A layout the file can be read with: built-in, saved by the org, or chosen in the mapping step. */
export type Layout = {
  formatId: string;
  name: string;
  verified: boolean;
  columnMap: BankColumnMap;
  conventions: BankConventions;
  dropRows?: readonly RegExp[];
};

export type StatementFile = {
  sheet: StatementSheet;
  signature: string;
  fingerprint: string;
  /** The built-in layout the header row belongs to, if any. */
  builtIn: { format: BankFormatDef; layout: Layout } | null;
  /** The header-word guess, for the mapping step of an unrecognised file. */
  guess: { columnMap: BankColumnMap; conventions: BankConventions };
  source: StatementSource;
  /** What a kl_to_1c reading recovered from (duplicate keys, missing section ends, repeated account sections). */
  warnings: (ExchangeWarning | SectionWarning)[];
};

type Raw =
  | { kind: 'grid'; grid: (readonly string[] | undefined)[]; extra: number; source: StatementSource }
  | { kind: 'exchange'; bytes: Uint8Array; source: StatementSource };

const PDF = [0x25, 0x50, 0x44, 0x46];
/** Entries of an archive that are not the statement: folders, macOS resource forks, hidden files. */
const NOISE_ENTRY = /(^|\/)(__MACOSX|\.)[^/]*/;

/** The single file inside a zip that is not an .xlsx (an .xlsx is a zip itself). */
async function unzip(bytes: Buffer): Promise<{ name: string; bytes: Buffer }> {
  if (!(await zipWithinLimits(bytes))) throw new StatementReadError('zip_limits');
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    throw new StatementReadError('unreadable');
  }
  const files = Object.values(zip.files).filter((f) => !f.dir && !NOISE_ENTRY.test(f.name));
  if (files.length === 0) throw new StatementReadError('archive_empty');
  if (files.length > 1) throw new StatementReadError('archive_many');
  const file = files[0] as JSZip.JSZipObject;
  return { name: file.name.split('/').pop() ?? file.name, bytes: await file.async('nodebuffer') };
}

async function isXlsxPackage(bytes: Buffer): Promise<boolean> {
  try {
    const zip = await JSZip.loadAsync(bytes);
    return zip.file('[Content_Types].xml') !== null && Object.keys(zip.files).some((n) => n.startsWith('xl/'));
  } catch {
    return false;
  }
}

async function rawStatement(bytes: Buffer, archived: string | null = null): Promise<Raw> {
  const base: StatementSource = { kind: 'text', encoding: null, delimiter: null, fixedWidth: false, archived };
  if (PDF.every((b, i) => bytes[i] === b)) throw new StatementReadError('pdf');
  if (looksLikeZip(bytes) && !(await isXlsxPackage(bytes))) {
    if (archived !== null) throw new StatementReadError('archive_many');
    const inner = await unzip(bytes);
    return rawStatement(inner.bytes, inner.name);
  }
  const kind = sniffKind(bytes);
  if (kind === 'xlsx') {
    const raw = await readGrid(bytes);
    return { kind: 'grid', grid: raw.grid, extra: raw.extra, source: { ...base, kind: 'xlsx' } };
  }
  if (kind === 'xls') {
    try {
      const { grid, extra } = readXls(bytes);
      return { kind: 'grid', grid, extra, source: { ...base, kind: 'xls' } };
    } catch (error) {
      if (error instanceof XlsError) throw new StatementReadError(error.code === 'encrypted' ? 'xls_encrypted' : error.code === 'old_format' ? 'xls_old' : 'unreadable');
      throw new StatementReadError('unreadable');
    }
  }
  if (looksBinary(bytes)) throw new StatementReadError('binary');
  const { text, encoding } = decodeCyrillic(bytes);
  if (isBankExchange(text)) return { kind: 'exchange', bytes, source: { ...base, kind: 'exchange', encoding } };
  const markup = markupKind(text);
  if (markup) return { kind: 'grid', grid: markup === 'html' ? htmlGrid(text) : spreadsheetMlGrid(text), extra: 0, source: { ...base, kind: markup, encoding } };
  const read = readStatementText(bytes);
  return { kind: 'grid', grid: read.grid, extra: 0, source: { ...base, encoding: read.encoding, delimiter: read.delimiter, fixedWidth: read.fixedWidth } };
}

export async function readStatementFile(bytes: Buffer): Promise<StatementFile> {
  const raw = await rawStatement(bytes);
  let sheet: StatementSheet;
  let chosen: string | null = null;
  let warnings: StatementFile['warnings'] = [];
  if (raw.kind === 'exchange') {
    const exchange = exchangeStatement(parseBankExchange(raw.bytes));
    sheet = exchange.sheet;
    warnings = exchange.warnings;
    chosen = 'onec_client_bank_exchange';
  } else {
    sheet = locateTable(raw.grid, raw.extra);
    const documents = payerPayeeColumns(sheet.headers);
    if (documents) {
      sheet = payerPayeeStatement(sheet, documents, readTitle(sheet.titleRows).account);
      chosen = 'payer_payee_documents';
    }
  }
  const detected = chosen ? layoutFor(chosen, sheet.headers) : detectFormat(sheet.headers);
  return {
    sheet,
    signature: headerSignature(sheet.headers),
    fingerprint: fileFingerprint(bytes),
    builtIn: detected ? {
      format: detected.format,
      layout: { formatId: detected.format.id, name: detected.format.name, verified: detected.format.verified, columnMap: detected.columnMap, conventions: detected.conventions, dropRows: detected.format.dropRows },
    } : null,
    guess: guessMapping(sheet.headers),
    source: raw.source,
    warnings,
  };
}

/** Reads every line of the file with a layout. */
export function readLines(file: Pick<StatementFile, 'sheet' | 'signature'>, layout: Layout): ParsedStatement {
  return parseStatement(file.sheet, {
    columnMap: layout.columnMap, conventions: layout.conventions, formatId: layout.formatId, formatName: layout.name,
    verified: layout.verified, signature: file.signature, dropRows: layout.dropRows,
  });
}
