// Legacy Excel 97–2003 (.xls) statements, B2: ASBT banks list «Ведомость проведенных документов за
// период (xls)» among their reports (bank research §2.2, Ziraat manual 4.4), and older Uzbek bank
// back offices still save .xls. Only what a statement needs is read: the first worksheet's cell
// values (shared and inline strings, numbers, RK numbers, formula results, booleans) of a BIFF8
// workbook inside an OLE compound file. Formats, styles, merged cells and other sheets are not
// read; dates arrive as Excel serial numbers, which the date reader already takes. Encrypted
// workbooks and BIFF5 (Excel 95) are refused. Every offset is bounds-checked: a damaged file throws
// XlsError, it never reads past the buffer or loops. Pure.
import { numberText } from '../spreadsheet.js';
import { MAX_COLUMNS, MAX_ROWS } from '../sheet-shape.js';

export class XlsError extends Error {
  constructor(readonly code: 'unreadable' | 'encrypted' | 'old_format') {
    super(code);
    this.name = 'XlsError';
  }
}

const SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const END_OF_CHAIN = 0xfffffffe;
const FREE = 0xffffffff;
/** Sectors a chain may span (a 20 MB upload of 512-byte sectors is ~41 000). */
const MAX_CHAIN = 200_000;

const fail = (code: XlsError['code'] = 'unreadable'): never => { throw new XlsError(code); };

function u16(b: Buffer, at: number): number {
  if (at < 0 || at + 2 > b.length) fail();
  return b.readUInt16LE(at);
}
function u32(b: Buffer, at: number): number {
  if (at < 0 || at + 4 > b.length) fail();
  return b.readUInt32LE(at);
}

// ── The OLE compound file ────────────────────────────────────────────────────────────────────

type Entry = { name: string; type: number; start: number; size: number };

/** The named stream's bytes, or null when the file has no such stream. */
export function cfbStream(file: Buffer, names: readonly string[]): Buffer | null {
  if (file.length < 512 || !SIGNATURE.every((b, i) => file[i] === b)) fail();
  const sectorSize = 1 << u16(file, 0x1e);
  const miniSize = 1 << u16(file, 0x20);
  if (sectorSize !== 512 && sectorSize !== 4096) fail();
  const fatCount = u32(file, 0x2c);
  const dirStart = u32(file, 0x30);
  const cutoff = u32(file, 0x38);
  const miniFatStart = u32(file, 0x3c);
  let difatNext = u32(file, 0x44);
  const sectorAt = (n: number): number => (n + 1) * sectorSize;
  // The FAT cannot have more sectors than the file holds: a header claiming a million of them in a 1 KB
  // file would otherwise grow the FAT array until the process dies (an uncatchable V8 abort).
  const sectorCount = Math.floor(file.length / sectorSize) - 1;
  if (fatCount > sectorCount) fail();

  // The FAT's own sectors: 109 in the header, the rest in the DIFAT chain.
  const fatSectors: number[] = [];
  for (let i = 0; i < 109 && fatSectors.length < fatCount; i++) fatSectors.push(u32(file, 0x4c + i * 4));
  for (let guard = 0; fatSectors.length < fatCount && difatNext !== END_OF_CHAIN && difatNext !== FREE; guard++) {
    if (guard > MAX_CHAIN) fail();
    const base = sectorAt(difatNext);
    const per = sectorSize / 4 - 1;
    for (let i = 0; i < per && fatSectors.length < fatCount; i++) fatSectors.push(u32(file, base + i * 4));
    difatNext = u32(file, base + per * 4);
  }
  const fat: number[] = [];
  for (const s of fatSectors) {
    if (s >= sectorCount) fail();
    for (let i = 0; i < sectorSize / 4; i++) fat.push(u32(file, sectorAt(s) + i * 4));
  }

  const chain = (start: number, table: readonly number[]): number[] => {
    const out: number[] = [];
    const seen = new Set<number>();
    for (let s = start; s !== END_OF_CHAIN && s !== FREE; s = table[s] ?? fail()) {
      if (seen.has(s) || out.length > MAX_CHAIN) fail();
      seen.add(s);
      out.push(s);
    }
    return out;
  };
  const readChain = (start: number, size: number): Buffer => {
    const parts = chain(start, fat).map((s) => {
      const at = sectorAt(s);
      if (at >= file.length) fail();
      return file.subarray(at, Math.min(at + sectorSize, file.length));
    });
    const all = Buffer.concat(parts);
    if (all.length < size) fail();
    return all.subarray(0, size);
  };

  const dir = readChain(dirStart, chain(dirStart, fat).length * sectorSize);
  const entries: Entry[] = [];
  for (let at = 0; at + 128 <= dir.length; at += 128) {
    const nameBytes = Math.min(64, u16(dir, at + 0x40));
    const name = dir.subarray(at, at + Math.max(0, nameBytes - 2)).toString('utf16le');
    entries.push({ name, type: dir[at + 0x42] ?? 0, start: u32(dir, at + 0x74), size: u32(dir, at + 0x78) });
  }
  const root = entries.find((e) => e.type === 5) ?? fail();
  const entry = entries.find((e) => e.type === 2 && names.includes(e.name));
  if (!entry) return null;
  if (entry.size >= cutoff) return readChain(entry.start, entry.size);

  // A small stream lives in the mini stream (the root entry's chain), in 64-byte mini sectors.
  const ministream = readChain(root.start, root.size);
  const miniFat: number[] = [];
  if (miniFatStart !== END_OF_CHAIN) {
    const bytes = readChain(miniFatStart, chain(miniFatStart, fat).length * sectorSize);
    for (let i = 0; i + 4 <= bytes.length; i += 4) miniFat.push(bytes.readUInt32LE(i));
  }
  const parts = chain(entry.start, miniFat).map((m) => {
    const at = m * miniSize;
    if (at + miniSize > ministream.length) fail();
    return ministream.subarray(at, at + miniSize);
  });
  const all = Buffer.concat(parts);
  if (all.length < entry.size) fail();
  return all.subarray(0, entry.size);
}

// ── BIFF8 records ────────────────────────────────────────────────────────────────────────────

const BOF = 0x0809;
const EOF = 0x000a;
const FILEPASS = 0x002f;
const BOUNDSHEET = 0x0085;
const SST = 0x00fc;
const CONTINUE = 0x003c;
const LABELSST = 0x00fd;
const LABEL = 0x0204;
const NUMBER = 0x0203;
const RK = 0x027e;
const MULRK = 0x00bd;
const FORMULA = 0x0006;
const STRING = 0x0207;
const BOOLERR = 0x0205;

type Rec = { type: number; data: Buffer; offset: number };

function records(stream: Buffer, from: number): Rec[] {
  const out: Rec[] = [];
  for (let at = from; at + 4 <= stream.length;) {
    const type = stream.readUInt16LE(at);
    const len = stream.readUInt16LE(at + 2);
    if (at + 4 + len > stream.length) break;
    out.push({ type, data: stream.subarray(at + 4, at + 4 + len), offset: at });
    at += 4 + len;
    if (type === EOF) break;
  }
  return out;
}

/** An RK number: a 30-bit integer or the top 30 bits of a double, optionally divided by 100. */
export function rkValue(rk: number): number {
  let value: number;
  if (rk & 0x02) value = rk >> 2;
  else {
    const b = Buffer.alloc(8);
    // Unsigned: a negative double has the sign bit set, which `&` leaves as a negative int32.
    b.writeUInt32LE((rk & 0xfffffffc) >>> 0, 4);
    value = b.readDoubleLE(0);
  }
  return rk & 0x01 ? value / 100 : value;
}

/** Characters of a BIFF8 string: one byte each (compressed Latin-1) or UTF-16LE. */
const chars = (data: Buffer, at: number, count: number, wide: boolean): string =>
  wide ? data.subarray(at, at + count * 2).toString('utf16le') : data.subarray(at, at + count).toString('latin1');

/** XLUnicodeString (LABEL, STRING): cch u16, flags u8, characters. */
function unicodeString(data: Buffer, at: number): string {
  const count = u16(data, at);
  const wide = ((data[at + 2] ?? 0) & 0x01) === 1;
  return chars(data, at + 3, count, wide);
}

/**
 * The shared string table: the SST record and its CONTINUE records. A string's characters may
 * break across a CONTINUE, which then starts with a new flags byte for the rest of them.
 */
function sharedStrings(parts: readonly Buffer[]): string[] {
  const out: string[] = [];
  const total = parts[0] ? u32(parts[0], 4) : 0;
  let part = 0;
  let at = 8;
  const cur = (): Buffer => parts[part] ?? fail();
  /** Moves to the next CONTINUE record; inside a string's characters it starts with a flags byte. */
  const next = (midString: boolean): boolean => {
    part++;
    at = 0;
    if (part >= parts.length) fail();
    if (!midString) return false;
    at = 1;
    return ((cur()[0] ?? 0) & 0x01) === 1;
  };
  for (let n = 0; n < total && n < 2_000_000; n++) {
    while (at >= cur().length) {
      if (part === parts.length - 1) return out;
      next(false);
    }
    const count = u16(cur(), at);
    const flags = cur()[at + 2] ?? 0;
    at += 3;
    let wide = (flags & 0x01) === 1;
    let skip = 0;
    if (flags & 0x08) { skip += u16(cur(), at) * 4; at += 2; }
    if (flags & 0x04) { skip += u32(cur(), at); at += 4; }
    let text = '';
    let left = count;
    while (left > 0) {
      const room = Math.floor((cur().length - at) / (wide ? 2 : 1));
      if (room <= 0) { wide = next(true); continue; }
      const take = Math.min(left, room);
      text += chars(cur(), at, take, wide);
      at += take * (wide ? 2 : 1);
      left -= take;
    }
    // Formatting runs and the extended block are skipped, also across a CONTINUE.
    while (skip > 0) {
      if (at >= cur().length) next(false);
      const step = Math.min(skip, cur().length - at);
      at += step;
      skip -= step;
    }
    out.push(text);
  }
  return out;
}

/**
 * The first worksheet with cells as a grid: rows at their sheet row index (undefined = empty row),
 * cells as text. Rows past MAX_ROWS (+ title room) are counted in `extra`, not kept.
 */
export function readXls(file: Buffer): { grid: (string[] | undefined)[]; extra: number } {
  const stream = cfbStream(file, ['Workbook', 'WORKBOOK', 'workbook']);
  if (!stream) {
    if (cfbStream(file, ['Book', 'BOOK'])) fail('old_format');
    fail();
  }
  const book = stream as Buffer;
  const globals = records(book, 0);
  const first = globals[0];
  if (!first || first.type !== BOF) fail();
  if (u16(first!.data, 0) !== 0x0600) fail('old_format');
  if (globals.some((r) => r.type === FILEPASS)) fail('encrypted');

  const sstParts: Buffer[] = [];
  const sheets: number[] = [];
  for (let i = 0; i < globals.length; i++) {
    const r = globals[i] as Rec;
    if (r.type === BOUNDSHEET && ((r.data[5] ?? 0) === 0)) sheets.push(u32(r.data, 0));
    if (r.type === SST) {
      sstParts.push(r.data);
      for (let j = i + 1; globals[j]?.type === CONTINUE; j++) sstParts.push((globals[j] as Rec).data);
    }
  }
  const sst = sstParts.length > 0 ? sharedStrings(sstParts) : [];
  const keep = MAX_ROWS + 20;

  for (const offset of sheets) {
    if (offset >= book.length) continue;
    const grid: (string[] | undefined)[] = [];
    let kept = 0;
    let extra = 0;
    const put = (row: number, col: number, text: string): void => {
      if (col >= MAX_COLUMNS || text === '') return;
      let cells = grid[row];
      if (!cells) {
        if (kept >= keep) { extra++; return; }
        cells = [];
        grid[row] = cells;
        kept++;
      }
      while (cells.length < col) cells.push('');
      cells[col] = text;
    };
    let pendingString: { row: number; col: number } | null = null;
    for (const r of records(book, offset).slice(1)) {
      const d = r.data;
      switch (r.type) {
        case LABELSST: put(u16(d, 0), u16(d, 2), (sst[u32(d, 6)] ?? '').trim()); break;
        case LABEL: put(u16(d, 0), u16(d, 2), unicodeString(d, 6).trim()); break;
        case NUMBER: if (d.length >= 14) put(u16(d, 0), u16(d, 2), numberText(d.readDoubleLE(6))); break;
        case RK: put(u16(d, 0), u16(d, 2), numberText(rkValue(u32(d, 6)))); break;
        case MULRK: {
          const row = u16(d, 0);
          const firstCol = u16(d, 2);
          for (let k = 0; 4 + k * 6 + 6 <= d.length - 2; k++) put(row, firstCol + k, numberText(rkValue(u32(d, 4 + k * 6 + 2))));
          break;
        }
        case FORMULA: {
          if (d.length < 14) break;
          const row = u16(d, 0);
          const col = u16(d, 2);
          if (u16(d, 12) === 0xffff) {
            const kind = d[6];
            if (kind === 0) pendingString = { row, col };
            else if (kind === 1) put(row, col, d[8] ? 'TRUE' : 'FALSE');
          } else put(row, col, numberText(d.readDoubleLE(6)));
          break;
        }
        case STRING: if (pendingString) { put(pendingString.row, pendingString.col, unicodeString(d, 0).trim()); pendingString = null; } break;
        case BOOLERR: if (d[7] === 0) put(u16(d, 0), u16(d, 2), d[6] ? 'TRUE' : 'FALSE'); break;
        default: break;
      }
    }
    if (kept > 0) return { grid, extra };
  }
  return { grid: [], extra: 0 };
}
