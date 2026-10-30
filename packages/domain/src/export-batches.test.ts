// The catalogue export reads its rows in batches (exportLineBatches): a 4,500-row catalogue read
// 1,000 rows at a time gives the same lines, in the same order, as one batch and as the unbatched
// reader, with skipped rows at the edges and across batch boundaries; and the rows written from
// them (codes, units, statuses) and the export's counts are the same too.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { db } from '@tasnivo/db';
import { exportFileRows, newTally, type ExportTally } from './catalog-exports.js';
import { exportLineBatches, exportLines, type ExportLine } from './export-rows.js';
import { dbSkipReason, dropOrgs, liveCodes, makeOrg } from './test-fixtures.js';

const skip = await dbSkipReason();
const ROWS = 4_500;
// Nameless rows: the first and last file rows, a run across the first batch edge, and every 37th.
const isSkipped = (i: number): boolean => i === 0 || i === ROWS - 1 || (i >= 995 && i <= 1_005) || i % 37 === 0;

async function collect(catalogId: string, batchSize: number): Promise<{ sizes: number[]; lines: ExportLine[] }> {
  const sizes: number[] = [];
  const lines: ExportLine[] = [];
  for await (const batch of exportLineBatches(catalogId, { batchSize })) {
    sizes.push(batch.length);
    lines.push(...batch);
  }
  return { sizes, lines };
}

async function written(catalogId: string, batchSize: number): Promise<{ rows: unknown[]; tally: ExportTally }> {
  const tally = newTally();
  const rows: unknown[] = [];
  const mapping = { mxik: 2, unit: 1, barcode: -1 };
  for await (const { row } of exportFileRows(catalogId, mapping, 'uz', tally, { batchSize })) rows.push(row);
  return { rows, tally };
}

describe('export in batches (database)', { skip }, () => {
  let orgId = '';
  let catalogId = '';

  before(async () => {
    const [code = '', other = ''] = await liveCodes(2);
    orgId = (await makeOrg()).orgId;
    const catalog = await db.catalog.create({
      data: { orgId, filename: 'batches.xlsx', rowCount: ROWS, status: 'ready', headers: ['name', 'unit', 'mxik'], columnMap: { name: 0, barcode: -1, mxik: 2, unit: 1, price: -1 } },
    });
    catalogId = catalog.id;
    const indexes = Array.from({ length: ROWS }, (_, i) => i);
    await db.catalogSkippedRow.createMany({
      data: indexes.filter(isSkipped).map((rowIndex) => ({ catalogId, rowIndex, reason: 'no_name', original: ['', 'dona', String(rowIndex)] })),
    });
    const wanted = indexes.filter((i) => !isSkipped(i));
    for (let start = 0; start < wanted.length; start += 1_000) {
      const items = await db.catalogItem.createManyAndReturn({
        data: wanted.slice(start, start + 1_000).map((rowIndex) => ({
          catalogId, rowIndex, rawName: `Mahsulot ${rowIndex}`, normalizedName: '', unit: 'dona', existingMxik: rowIndex % 2 ? other : null,
          attrs: { original: [`Mahsulot ${rowIndex}`, 'dona', rowIndex % 2 ? other : ''] }, checkError: rowIndex % 101 === 0 ? 'timeout' : null,
        })),
        select: { id: true, rowIndex: true },
      });
      // Accepted, pending, rejected and no finding, in turn.
      await db.finding.createMany({
        data: items.flatMap(({ id, rowIndex }) => {
          const kind = rowIndex % 4;
          if (kind === 3) return [];
          const decision = kind === 0 ? 'accepted' as const : kind === 1 ? 'pending' as const : 'rejected' as const;
          return [{
            itemId: id, type: 'MISSING' as const, severity: 'high' as const, suggestedMxik: code, confidence: 0.9, alternatives: [], reason: 'test',
            decision, chosenMxik: decision === 'accepted' ? code : null, decidedAt: decision === 'pending' ? null : new Date(1_700_000_000_000 + rowIndex),
          }];
        }),
      });
    }
  });
  after(async () => {
    await dropOrgs([orgId]);
  });

  it('1,000 rows at a time gives the lines of one batch and of the unbatched reader, in file order', async () => {
    const batched = await collect(catalogId, 1_000);
    const single = await collect(catalogId, 10_000);
    assert.deepEqual(batched.sizes, [1_000, 1_000, 1_000, 1_000, 500]);
    assert.deepEqual(single.sizes, [ROWS]);
    assert.deepEqual(batched.lines, single.lines);
    assert.deepEqual(batched.lines, (await exportLines(catalogId)).lines);
    assert.deepEqual(batched.lines.map((l) => (l.kind === 'item' ? l.item.rowIndex : l.row.rowIndex)), Array.from({ length: ROWS }, (_, i) => i));
    assert.equal(batched.lines.filter((l) => l.kind === 'skipped').length, Array.from({ length: ROWS }, (_, i) => i).filter(isSkipped).length);
  });

  it('the rows written and the export counts do not depend on the batch size', async () => {
    const batched = await written(catalogId, 1_000);
    const single = await written(catalogId, 10_000);
    assert.equal(batched.rows.length, ROWS);
    assert.deepEqual(batched.rows, single.rows);
    assert.deepEqual(batched.tally, single.tally);
    assert.equal(batched.tally.rows, ROWS);
    assert.ok(batched.tally.skipped > 0 && batched.tally.failed > 0 && batched.tally.pending > 0 && batched.tally.acceptedCodes.size === 1);
  });
});
