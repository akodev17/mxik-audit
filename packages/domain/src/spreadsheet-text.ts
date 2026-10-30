// Text uploads (CSV and friends): encoding, delimiter and the cell grid. Pure.
// Excel in a Russian or Uzbek locale saves CSV as windows-1251 with ';', other
// tools as UTF-8 with ',' or tab, and 1C exports add a byte-order mark.

export type TextEncodingName = 'utf-8' | 'windows-1251';
export type Delimiter = ';' | ',' | '\t';

const BOM = '﻿';

/** UTF-8 when the bytes are valid UTF-8, otherwise windows-1251. The BOM is dropped. */
export function decodeText(buffer: Uint8Array): { text: string; encoding: TextEncodingName } {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    return { text: text.startsWith(BOM) ? text.slice(1) : text, encoding: 'utf-8' };
  } catch {
    const text = new TextDecoder('windows-1251').decode(buffer);
    return { text: text.startsWith(BOM) ? text.slice(1) : text, encoding: 'windows-1251' };
  }
}

export type CyrillicEncoding = 'utf-8' | 'windows-1251' | 'cp866';

/** Share of the non-ASCII letters that are plain Russian Cyrillic (А–я): near 1 for the right code page. */
function cyrillicShare(text: string): number {
  let other = 0;
  let cyrillic = 0;
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (code < 0x80) continue;
    if (code >= 0x0410 && code <= 0x044f) cyrillic++;
    else other++;
  }
  return cyrillic + other === 0 ? 1 : cyrillic / (cyrillic + other);
}

/**
 * Decodes by content, not by what the file claims (bank research §1.3, §7.2): a UTF-8 BOM, then
 * strict UTF-8, else windows-1251 or DOS cp866, whichever reads as more Russian Cyrillic (a cp866
 * file read as 1251 turns half its letters into symbols, and the other way round).
 */
export function decodeCyrillic(buffer: Uint8Array): { text: string; encoding: CyrillicEncoding } {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    return { text: text.startsWith(BOM) ? text.slice(1) : text, encoding: 'utf-8' };
  } catch {
    const head = buffer.subarray(0, 65_536);
    const win = new TextDecoder('windows-1251').decode(head);
    const dos = new TextDecoder('ibm866').decode(head);
    const encoding = cyrillicShare(dos) > cyrillicShare(win) ? 'cp866' : 'windows-1251';
    return { text: new TextDecoder(encoding === 'cp866' ? 'ibm866' : 'windows-1251').decode(buffer), encoding };
  }
}

/** True when the bytes look like a binary file rather than text (NUL bytes early on). */
export function looksBinary(buffer: Uint8Array): boolean {
  const head = buffer.subarray(0, 4096);
  return head.includes(0);
}

const CANDIDATES: readonly Delimiter[] = [';', '\t', ','];
/** Bank client exports also use '|' and '~' (ASBT's document export takes any character). */
export const STATEMENT_DELIMITERS = [';', '\t', ',', '|', '~'] as const;
export type StatementDelimiter = (typeof STATEMENT_DELIMITERS)[number];

/** Per-line counts of each candidate outside quotes, over the first lines. */
function delimiterCounts<D extends string>(text: string, maxLines: number, candidates: readonly D[]): Map<D, number[]> {
  const counts = new Map<D, number[]>(candidates.map((d) => [d, []]));
  const current = new Map<D, number>(candidates.map((d) => [d, 0]));
  const isCandidate = (ch: string): ch is D => (candidates as readonly string[]).includes(ch);
  let quoted = false;
  let lines = 0;
  let lineHasText = false;
  const endLine = (): void => {
    if (lineHasText) {
      for (const d of candidates) counts.get(d)?.push(current.get(d) ?? 0);
      lines++;
    }
    for (const d of candidates) current.set(d, 0);
    lineHasText = false;
  };
  for (let i = 0; i < text.length && lines < maxLines; i++) {
    const ch = text[i] ?? '';
    if (ch === '"') { quoted = !quoted; lineHasText = true; continue; }
    if (quoted) continue;
    if (ch === '\n') { endLine(); continue; }
    if (ch === '\r') continue;
    if (isCandidate(ch)) current.set(ch, (current.get(ch) ?? 0) + 1);
    if (ch.trim() !== '') lineHasText = true;
  }
  endLine();
  return counts;
}

function mode(values: readonly number[]): { value: number; hits: number } {
  const tally = new Map<number, number>();
  for (const v of values) tally.set(v, (tally.get(v) ?? 0) + 1);
  let best = { value: 0, hits: 0 };
  for (const [value, hits] of tally) {
    if (hits > best.hits || (hits === best.hits && value > best.value)) best = { value, hits };
  }
  return best;
}

/**
 * The delimiter used outside quotes: the candidate whose per-line count is most
 * consistent (and non-zero). Ties prefer ';', then tab, then ',', because a
 * comma is also the decimal separator in Uzbek and Russian numbers.
 */
export function sniffDelimiter(text: string, maxLines?: number): Delimiter;
export function sniffDelimiter<D extends string>(text: string, maxLines: number, candidates: readonly D[]): D;
export function sniffDelimiter(text: string, maxLines = 30, candidates: readonly string[] = CANDIDATES): string {
  const counts = delimiterCounts(text, maxLines, candidates);
  let best: { d: string; score: number; width: number } = { d: ';', score: -1, width: 0 };
  for (const d of candidates) {
    const m = mode(counts.get(d) ?? []);
    const score = m.value > 0 ? m.hits : 0;
    if (score > best.score || (score === best.score && score > 0 && m.value > best.width)) best = { d, score, width: m.value };
  }
  return best.score > 0 ? best.d : ',';
}

/** Splits text into rows of cells (RFC 4180 quoting: "" inside quotes, line breaks inside quotes). */
export function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] ?? '';
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"' && cell.trim() === '') { quoted = true; cell = ''; continue; }
    if (ch === delimiter) { row.push(cell); cell = ''; continue; }
    if (ch === '\r') continue;
    if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; continue; }
    cell += ch;
  }
  if (cell !== '' || row.length > 0) { row.push(cell); rows.push(row); }
  return rows;
}
