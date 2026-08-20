// Streaming reader for the tasnif.soliq.uz classifier export: a single sheet of
// ~439k rows / 205MB XML. SheetJS-style full-load parsers OOM on this, so we
// scan the machine-generated XML directly. Not a general-purpose xlsx parser.
import yauzl, { type Entry, type ZipFile } from 'yauzl';
import type { Readable } from 'node:stream';

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
};

export function decodeXml(s: string): string {
  if (!s.includes('&')) return s;
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-z]+);/g, (whole, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) {
      return String.fromCodePoint(parseInt(body.slice(2), 16));
    }
    if (body.startsWith('#')) return String.fromCodePoint(parseInt(body.slice(1), 10));
    return ENTITIES[body] ?? whole;
  });
}

function openEntry(file: string, entryName: string): Promise<Readable> {
  return new Promise((resolve, reject) => {
    yauzl.open(file, { lazyEntries: true, autoClose: false }, (err: Error | null, zip?: ZipFile) => {
      if (err || !zip) return reject(err ?? new Error('zip open failed'));
      let found = false;
      zip.on('entry', (entry: Entry) => {
        if (entry.fileName !== entryName) return zip.readEntry();
        found = true;
        zip.openReadStream(entry, (e: Error | null, stream?: Readable) => {
          if (e || !stream) return reject(e ?? new Error('stream failed'));
          resolve(stream);
        });
      });
      zip.on('end', () => { if (!found) reject(new Error(`entry not found: ${entryName}`)); });
      zip.readEntry();
    });
  });
}

// Feeds `sink` every complete <tag>...</tag> block, buffering across chunk boundaries.
async function scanBlocks(
  stream: Readable,
  tag: string,
  sink: (block: string) => void,
): Promise<void> {
  const open = `<${tag}`;
  const close = `</${tag}>`;
  // Self-closing empty elements (<si/>, <row/>) still need to be emitted.
  let buf = '';
  for await (const chunk of stream) {
    buf += (chunk as Buffer).toString('utf8');
    let cursor = 0;
    for (;;) {
      const start = buf.indexOf(open, cursor);
      if (start === -1) break;
      const gt = buf.indexOf('>', start);
      if (gt === -1) break;
      if (buf[gt - 1] === '/') { sink(buf.slice(start, gt + 1)); cursor = gt + 1; continue; }
      const end = buf.indexOf(close, gt);
      if (end === -1) break;
      sink(buf.slice(start, end + close.length));
      cursor = end + close.length;
    }
    buf = buf.slice(cursor);
  }
}

/** Shared-string table. Index order in the file is the index used by <c t="s"><v>N</v>. */
export async function readSharedStrings(file: string): Promise<string[]> {
  const out: string[] = [];
  let stream: Readable;
  try {
    stream = await openEntry(file, 'xl/sharedStrings.xml');
  } catch {
    return out; // workbook may inline every string
  }
  await scanBlocks(stream, 'si', (block) => {
    // <si> holds either one <t>, or several <r><t> runs that must be concatenated.
    let text = '';
    for (const m of block.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) text += m[1] ?? '';
    out.push(decodeXml(text));
  });
  return out;
}

export type Row = { index: number; cells: (string | null)[] };

/** Yields one row at a time; `cells` is dense and 0-based on column A. */
export async function* readRows(
  file: string,
  shared: string[],
  sheetPath = 'xl/worksheets/sheet1.xml',
): AsyncGenerator<Row> {
  const stream = await openEntry(file, sheetPath);
  const queue: Row[] = [];
  const scan = scanBlocks(stream, 'row', (block) => {
    const rowRef = /<row[^>]*\sr="(\d+)"/.exec(block);
    const index = rowRef ? Number(rowRef[1]) : 0;
    const cells: (string | null)[] = [];
    for (const m of block.matchAll(/<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = m[1] ?? '';
      const body = m[2] ?? '';
      // The outer pattern already ate the space after `<c`, so attrs can start at `r=`.
      const ref = /(?:^|\s)r="([A-Z]+)\d+"/.exec(attrs);
      if (!ref?.[1]) continue;
      const col = colToIndex(ref[1]);
      const type = /(?:^|\s)t="([^"]+)"/.exec(attrs)?.[1];
      let value: string | null = null;
      if (type === 's') {
        const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
        if (v !== undefined) value = shared[Number(v)] ?? null;
      } else if (type === 'inlineStr') {
        let t = '';
        for (const tm of body.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) t += tm[1] ?? '';
        value = decodeXml(t);
      } else {
        const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
        if (v !== undefined) value = decodeXml(v);
      }
      while (cells.length < col) cells.push(null);
      cells[col] = value === '' ? null : value;
    }
    queue.push({ index, cells });
  });
  // scanBlocks resolves only at stream end, so drain the queue as it fills.
  let done = false;
  scan.then(() => { done = true; }, () => { done = true; });
  while (!done || queue.length > 0) {
    if (queue.length === 0) { await new Promise((r) => setImmediate(r)); continue; }
    yield queue.shift()!; // guarded by queue.length above
  }
  await scan;
}

export function colToIndex(col: string): number {
  let n = 0;
  for (const ch of col) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}
