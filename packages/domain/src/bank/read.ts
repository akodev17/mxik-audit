// An uploaded statement file → its table, its layout (a built-in one, the org's saved one, or a
// guess for the mapping step) and its fingerprint. Server-only (the xlsx reader).
import { createHash } from 'node:crypto';
import type { BankColumnMap, BankConventions } from '@tasnivo/contracts/modules/bank';
import { readGrid } from '../spreadsheet.js';
import { detectFormat, guessMapping, headerSignature, type BankFormatDef } from './formats/index.js';
import { parseStatement, type ParsedStatement } from './parse.js';
import { locateTable, type StatementSheet } from './sheet.js';

/** SHA-256 of the file's bytes: the same file uploaded twice is refused as a duplicate statement. */
export const fileFingerprint = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

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
};

export async function readStatementFile(bytes: Buffer): Promise<StatementFile> {
  const raw = await readGrid(bytes);
  const sheet = locateTable(raw.grid, raw.extra);
  const detected = detectFormat(sheet.headers);
  return {
    sheet,
    signature: headerSignature(sheet.headers),
    fingerprint: fileFingerprint(bytes),
    builtIn: detected ? {
      format: detected.format,
      layout: { formatId: detected.format.id, name: detected.format.name, verified: detected.format.verified, columnMap: detected.columnMap, conventions: detected.conventions, dropRows: detected.format.dropRows },
    } : null,
    guess: guessMapping(sheet.headers),
  };
}

/** Reads every line of the file with a layout. */
export function readLines(file: Pick<StatementFile, 'sheet' | 'signature'>, layout: Layout): ParsedStatement {
  return parseStatement(file.sheet, {
    columnMap: layout.columnMap, conventions: layout.conventions, formatId: layout.formatId, formatName: layout.name,
    verified: layout.verified, signature: file.signature, dropRows: layout.dropRows,
  });
}
