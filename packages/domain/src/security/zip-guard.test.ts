import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import JSZip from 'jszip';
import { looksLikeZip, zipUsage, zipWithinLimits } from './zip-guard.js';

const MB = 1024 * 1024;

async function zipOf(files: Record<string, string | Buffer>): Promise<Buffer> {
  const zip = new JSZip();
  for (const [name, body] of Object.entries(files)) zip.file(name, body);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

/** Rewrites every declared uncompressed size, as a crafted bomb would, leaving the data as it is. */
function lieAboutSizes(buffer: Buffer, declared: number): Buffer {
  const out = Buffer.from(buffer);
  for (let i = 0; i + 4 <= out.length; i++) {
    const sig = out.readUInt32LE(i);
    if (sig === 0x04034b50) out.writeUInt32LE(declared, i + 22);
    if (sig === 0x02014b50) out.writeUInt32LE(declared, i + 24);
  }
  return out;
}

describe('zipWithinLimits', () => {
  it('accepts an ordinary archive', async () => {
    const buffer = await zipOf({ '[Content_Types].xml': '<Types/>', 'xl/worksheets/sheet1.xml': '<row>Guruch</row>'.repeat(1000) });
    assert.equal(looksLikeZip(buffer), true);
    assert.equal(await zipWithinLimits(buffer), true);
  });

  it('refuses an archive that declares more than the limit', async () => {
    const buffer = await zipOf({ 'xl/sharedStrings.xml': Buffer.alloc(3 * MB) });
    assert.ok(buffer.length < 64 * 1024, 'compresses to almost nothing');
    assert.equal(await zipWithinLimits(buffer, { maxEntries: 100, maxTotalBytes: 1 * MB }), false);
  });

  it('refuses an archive whose declared sizes lie, by counting what really inflates', async () => {
    const honest = await zipOf({ 'xl/sharedStrings.xml': Buffer.alloc(3 * MB) });
    const lying = lieAboutSizes(honest, 100);
    assert.equal(await zipWithinLimits(lying, { maxEntries: 100, maxTotalBytes: 1 * MB }), false);
  });

  it('refuses too many entries', async () => {
    const files = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`f${i}.xml`, 'x']));
    assert.equal(await zipWithinLimits(await zipOf(files), { maxEntries: 10, maxTotalBytes: MB }), false);
  });

  it('refuses something that is not a zip at all', async () => {
    const csv = Buffer.from('nomi;kod\nGuruch;123\n');
    assert.equal(looksLikeZip(csv), false);
    assert.equal(await zipWithinLimits(csv), false);
  });
});

describe('zipUsage', () => {
  it('reports the entries and the inflated bytes, "over" past a limit, null for what is not a zip', async () => {
    const buffer = await zipOf({ 'a.txt': Buffer.alloc(3000, 1), 'c.txt': 'xy' });
    assert.deepEqual(await zipUsage(buffer), { entries: 2, bytes: 3002 });
    assert.equal(await zipUsage(buffer, { maxEntries: 1, maxTotalBytes: MB }), 'over');
    assert.equal(await zipUsage(buffer, { maxEntries: 10, maxTotalBytes: 1000 }), 'over');
    assert.equal(await zipUsage(lieAboutSizes(buffer, 10), { maxEntries: 10, maxTotalBytes: 1000 }), 'over', 'a lying size is caught by what really inflates');
    assert.equal(await zipUsage(Buffer.from('not a zip')), null);
  });
});
