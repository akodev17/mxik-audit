// "Excel" statements that are markup, not a workbook: many web back offices save an HTML table or an
// Excel 2003 XML (SpreadsheetML) document under an .xls name, and Excel opens both. No Uzbek bank
// documents which one it sends (bank research §2.2 "formats not published"), so both are read:
// every table row in document order (title tables included, so the title block still gives the
// account and the balances), a colspan/MergeAcross widening the row with empty cells. Text only:
// tags are dropped, entities decoded, scripts and styles ignored. Pure.
//
// Linear in the input: no pattern rescans to the end of the text from each place an unclosed construct
// starts (`<!--`, `<script`, `<Row>`, a run of `<`); repeated, such a scan froze the API for minutes on a
// 400 KB upload (review 30 Oct).

/** The kind of markup the text is, if it is one. */
export function markupKind(text: string): 'html' | 'spreadsheetml' | null {
  const head = text.slice(0, 4096).trimStart().toLowerCase();
  if (!head.startsWith('<')) return null;
  if (head.includes('urn:schemas-microsoft-com:office:spreadsheet') && /<(ss:)?workbook\b/.test(head)) return 'spreadsheetml';
  if (/<(html|table|!doctype html|meta|head|body)\b/.test(head) && /<table\b/i.test(text)) return 'html';
  return null;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', laquo: '«', raquo: '»', ndash: '–', mdash: '—', numero: '№' };

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name.startsWith('#x') || name.startsWith('#X')) return String.fromCodePoint(Math.min(parseInt(name.slice(2), 16), 0x10ffff));
    if (name.startsWith('#')) return String.fromCodePoint(Math.min(parseInt(name.slice(1), 10), 0x10ffff));
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
}

/** A cell's inner markup as one line of text. */
function cellText(inner: string): string {
  return decodeEntities(inner.replace(/<br\s*\/?>/gi, ' ').replace(/<[^<>]*>/g, ''))
    .replace(/[\s\u00a0]+/g, ' ')
    .trim();
}

const span = (attrs: string, name: RegExp): number => {
  const m = name.exec(attrs);
  const n = m ? Number(m[1]) : 1;
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 50) : 1;
};

/** The text without comments, scripts and styles; an unclosed one runs to the end, as in a browser. */
function withoutBlocks(text: string): string {
  const open = /<!--|<(script|style)\b/gi;
  let out = '';
  let at = 0;
  for (let m = open.exec(text); m; m = open.exec(text)) {
    out += text.slice(at, m.index);
    const close = m[1] ? new RegExp(`</${m[1]}\\s*>`, 'gi') : /-->/g;
    close.lastIndex = open.lastIndex;
    const end = close.exec(text);
    if (!end) return out;
    at = open.lastIndex = end.index + end[0].length;
  }
  return out + text.slice(at);
}

/** Each `<name …>…</name>` (or `<name …/>`) in order, `ss:` prefix optional; stops at an unclosed one. */
function* elements(text: string, name: string): Generator<{ attrs: string; inner: string }> {
  const open = new RegExp(`<(?:ss:)?${name}\\b([^<>]*?)(/?)>`, 'gi');
  const close = new RegExp(`</(?:ss:)?${name}>`, 'gi');
  for (let m = open.exec(text); m; m = open.exec(text)) {
    if (m[2]) {
      yield { attrs: m[1] ?? '', inner: '' };
      continue;
    }
    close.lastIndex = open.lastIndex;
    const end = close.exec(text);
    if (!end) return;
    yield { attrs: m[1] ?? '', inner: text.slice(open.lastIndex, end.index) };
    open.lastIndex = end.index + end[0].length;
  }
}

/** Rows of every HTML table in document order. */
/** Rows kept by the grids below; the ones past it are only counted in `limit.extra`. */
export type RowLimit = { maxRows: number; extra: number };

export function htmlGrid(text: string, limit: RowLimit = { maxRows: Infinity, extra: 0 }): string[][] {
  const clean = withoutBlocks(text);
  const rows: string[][] = [];
  // Columns a rowspan above still covers, with the rows it still covers: those columns are empty in the rows below, as
  // a merged cell reads in Excel, so a two-row header's lower row stays in its columns (review 30 Oct, R-B10).
  const covered = new Map<number, number>();
  for (const tr of clean.matchAll(/<tr\b[^<>]*>([\s\S]*?)(?=<tr\b|<\/table>|$)/gi)) {
    const cells: string[] = [];
    const skipCovered = (): void => {
      for (let left = covered.get(cells.length); left !== undefined; left = covered.get(cells.length)) {
        if (left <= 1) covered.delete(cells.length); else covered.set(cells.length, left - 1);
        cells.push('');
      }
    };
    for (const td of (tr[1] ?? '').matchAll(/<t([dh])\b([^<>]*)>([\s\S]*?)(?=<t[dh]\b|<\/tr>|$)/gi)) {
      skipCovered();
      const attrs = td[2] ?? '';
      const down = span(attrs, /rowspan\s*=\s*["']?(\d+)/i);
      const across = span(attrs, /colspan\s*=\s*["']?(\d+)/i);
      for (let k = 0; k < across; k++) {
        if (down > 1) covered.set(cells.length, down - 1);
        cells.push(k === 0 ? cellText((td[3] ?? '').replace(/<\/t[dh]>\s*$/i, '')) : '');
      }
    }
    skipCovered();
    if (rows.length < limit.maxRows) rows.push(cells);
    else if (cells.some(Boolean)) limit.extra++;
  }
  return rows;
}

/** Rows of the first worksheet of an Excel 2003 XML document, at their ss:Index. */
export function spreadsheetMlGrid(text: string, limit: RowLimit = { maxRows: Infinity, extra: 0 }): string[][] {
  const sheet = /<(?:ss:)?Worksheet\b[\s\S]*?<\/(?:ss:)?Worksheet>/i.exec(text)?.[0] ?? text;
  const rows: string[][] = [];
  for (const row of elements(sheet, 'Row')) {
    const index = /ss:Index\s*=\s*"(\d+)"/i.exec(row.attrs);
    if (index) while (rows.length < Number(index[1]) - 1 && rows.length < 1_000_000) rows.push([]);
    const cells: string[] = [];
    for (const cell of elements(row.inner, 'Cell')) {
      const at = /ss:Index\s*=\s*"(\d+)"/i.exec(cell.attrs);
      if (at) while (cells.length < Number(at[1]) - 1 && cells.length < 500) cells.push('');
      const data = /<(?:ss:)?Data\b[^<>]*>([\s\S]*?)<\/(?:ss:)?Data>/i.exec(cell.inner);
      cells.push(data ? cellText(data[1] ?? '') : '');
      const merge = Math.min(Number(/ss:MergeAcross\s*=\s*"(\d+)"/i.exec(cell.attrs)?.[1] ?? 0), 50);
      for (let k = 0; k < merge; k++) cells.push('');
    }
    if (rows.length < limit.maxRows) rows.push(cells);
    else if (cells.some(Boolean)) limit.extra++;
  }
  return rows;
}
