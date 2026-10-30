// "Excel" statements that are markup, not a workbook: many web back offices save an HTML table or an
// Excel 2003 XML (SpreadsheetML) document under an .xls name, and Excel opens both. No Uzbek bank
// documents which one it sends (bank research §2.2 "formats not published"), so both are read:
// every table row in document order (title tables included, so the title block still gives the
// account and the balances), a colspan/MergeAcross widening the row with empty cells. Text only:
// tags are dropped, entities decoded, scripts and styles ignored. Pure.

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
  return decodeEntities(inner.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, ''))
    .replace(/[\s ]+/g, ' ')
    .trim();
}

const span = (attrs: string, name: RegExp): number => {
  const m = name.exec(attrs);
  const n = m ? Number(m[1]) : 1;
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 50) : 1;
};

/** Rows of every HTML table in document order. */
export function htmlGrid(text: string): string[][] {
  const clean = text.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, '');
  const rows: string[][] = [];
  for (const tr of clean.matchAll(/<tr\b[^>]*>([\s\S]*?)(?=<tr\b|<\/table>|$)/gi)) {
    const cells: string[] = [];
    for (const td of (tr[1] ?? '').matchAll(/<t([dh])\b([^>]*)>([\s\S]*?)(?=<t[dh]\b|<\/tr>|$)/gi)) {
      cells.push(cellText((td[3] ?? '').replace(/<\/t[dh]>\s*$/i, '')));
      for (let k = 1; k < span(td[2] ?? '', /colspan\s*=\s*["']?(\d+)/i); k++) cells.push('');
    }
    rows.push(cells);
  }
  return rows;
}

/** Rows of the first worksheet of an Excel 2003 XML document, at their ss:Index. */
export function spreadsheetMlGrid(text: string): string[][] {
  const sheet = /<(?:ss:)?Worksheet\b[\s\S]*?<\/(?:ss:)?Worksheet>/i.exec(text)?.[0] ?? text;
  const rows: string[][] = [];
  for (const row of sheet.matchAll(/<(?:ss:)?Row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:ss:)?Row>)/gi)) {
    const index = /ss:Index\s*=\s*"(\d+)"/i.exec(row[1] ?? '');
    if (index) while (rows.length < Number(index[1]) - 1 && rows.length < 1_000_000) rows.push([]);
    const cells: string[] = [];
    for (const cell of (row[2] ?? '').matchAll(/<(?:ss:)?Cell\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:ss:)?Cell>)/gi)) {
      const at = /ss:Index\s*=\s*"(\d+)"/i.exec(cell[1] ?? '');
      if (at) while (cells.length < Number(at[1]) - 1 && cells.length < 500) cells.push('');
      const data = /<(?:ss:)?Data\b[^>]*>([\s\S]*?)<\/(?:ss:)?Data>/i.exec(cell[2] ?? '');
      cells.push(data ? cellText(data[1] ?? '') : '');
      const merge = Math.min(Number(/ss:MergeAcross\s*=\s*"(\d+)"/i.exec(cell[1] ?? '')?.[1] ?? 0), 50);
      for (let k = 0; k < merge; k++) cells.push('');
    }
    rows.push(cells);
  }
  return rows;
}
