// Refuses zip bombs before a spreadsheet library inflates an .xlsx in memory.
// The sizes an archive declares can lie, so every entry is also inflated as a stream
// and counted; yauzl stops a stream that grows past its declared size.
import yauzl, { type Entry, type ZipFile } from 'yauzl';

const MB = 1024 * 1024;

export type ZipLimits = { maxEntries: number; maxTotalBytes: number };
/** The whole archive; a worksheet streams (xlsx-stream.ts), so its size costs time, not memory. */
export const ZIP_LIMITS: ZipLimits = { maxEntries: 5_000, maxTotalBytes: 100 * MB };
/**
 * An .xlsx's parts held in memory while its sheet streams (workbook, rels, styles, shared strings).
 * Not the whole archive: one sheet of 60,000 rows x 20 columns alone inflates to about 43 MB.
 */
export const XLSX_HELD_BYTES = 30 * MB;

const OVER_BUDGET = 'zip entry over budget';
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

export const looksLikeZip = (buffer: Buffer): boolean => buffer.subarray(0, 4).equals(ZIP_MAGIC);

function open(buffer: Buffer): Promise<ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true, validateEntrySizes: true }, (error, zip) => (error ? reject(error) : resolve(zip)));
  });
}

function nextEntry(zip: ZipFile): Promise<Entry | null> {
  return new Promise((resolve, reject) => {
    const done = (): void => {
      zip.off('entry', onEntry);
      zip.off('end', onEnd);
      zip.off('error', onError);
    };
    const onEntry = (entry: Entry): void => { done(); resolve(entry); };
    const onEnd = (): void => { done(); resolve(null); };
    const onError = (error: Error): void => { done(); reject(error); };
    zip.on('entry', onEntry);
    zip.on('end', onEnd);
    zip.on('error', onError);
    zip.readEntry();
  });
}

/** Inflates one entry without keeping it; rejects once it passes `budget` bytes. */
function drain(zip: ZipFile, entry: Entry, budget: number): Promise<number> {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (error, stream) => {
      if (error) {
        reject(error);
        return;
      }
      let bytes = 0;
      stream.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > budget) stream.destroy(new Error(OVER_BUDGET));
      });
      stream.on('error', reject);
      stream.on('end', () => resolve(bytes));
    });
  });
}

export type ZipUsage = { entries: number; bytes: number };

/**
 * Inflates the archive within `limits` and reports what it holds (entries, inflated bytes): `'over'`
 * once it passes a limit, null when it does not open as a zip. A walk through nested archives
 * subtracts each usage from one shared budget (Phase C F6).
 */
export async function zipUsage(buffer: Buffer, limits: ZipLimits = ZIP_LIMITS): Promise<ZipUsage | 'over' | null> {
  let zip: ZipFile;
  try {
    zip = await open(buffer);
  } catch {
    return null;
  }
  try {
    if (zip.entryCount > limits.maxEntries) return 'over';
    let total = 0;
    for (let entry = await nextEntry(zip); entry; entry = await nextEntry(zip)) {
      if (entry.fileName.endsWith('/')) continue;
      if (total + entry.uncompressedSize > limits.maxTotalBytes) return 'over';
      total += await drain(zip, entry, limits.maxTotalBytes - total);
    }
    return { entries: zip.entryCount, bytes: total };
  } catch (error) {
    // yauzl's own size validation ("too many bytes in the stream") is a lying archive: over, not unreadable.
    return error instanceof Error && (error.message === OVER_BUDGET || error.message.includes('too many bytes')) ? 'over' : null;
  }
}

/** True when the archive opens and all of it inflates within the limits. */
export async function zipWithinLimits(buffer: Buffer, limits: ZipLimits = ZIP_LIMITS): Promise<boolean> {
  const usage = await zipUsage(buffer, limits);
  return usage !== null && usage !== 'over';
}
