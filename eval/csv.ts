// Minimal RFC 4180 CSV. Every cell stays a string, so 17-digit codes keep their
// leading zeros (exceljs would turn them into lossy numbers).

const BOM = String.fromCharCode(0xfeff);

/** Parses CSV text into rows of cells. Quoted fields may contain commas, quotes and newlines. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const src = text.startsWith(BOM) ? text.slice(1) : text;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++; continue; }
      if (ch === '"') { quoted = false; continue; }
      cell += ch;
      continue;
    }
    if (ch === '"') { quoted = true; continue; }
    if (ch === ',') { row.push(cell); cell = ''; continue; }
    if (ch === '\r') continue;
    if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; continue; }
    cell += ch;
  }
  if (cell !== '' || row.length > 0) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

function quote(cell: string): string {
  return /[",\n\r]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
}

export function toCsv(rows: readonly (readonly string[])[]): string {
  return rows.map((r) => r.map(quote).join(',')).join('\n') + '\n';
}
