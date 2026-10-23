// The Didox checks with the real interfaces (integration round 2): Agent 4's matchProducts and
// classifyProducts against a seeded catalogue and the loaded classifier, Agent 1's
// matchCounterparties, and the product read. Tasnif is kept off the network (TASNIF_LIVE=false).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { db } from '@tasnivo/db';
import { upsertProducts } from '../products/index.js';
import { gtin13 } from '../products/test-fixtures.js';
import { dbSkipReason, dropOrgs, liveCodes, makeOrg, type TestActor } from '../test-fixtures.js';
import { checkInvoice, defaultDeps } from './check.js';
import { parseDidoxDocument } from './document.js';
import { FIXTURE_DIR } from './fake-server.js';

process.env['TASNIF_LIVE'] = 'false';
const skip = await dbSkipReason();

describe('Didox checks with the real matcher, classifier and product read (database)', { skip }, () => {
  let org: TestActor;
  let codes: string[] = [];
  const brickBarcode = gtin13('478000000200');

  before(async () => {
    org = await makeOrg();
    codes = await liveCodes(5);
    const blank = { productId: null, onecRef: null, mxikName: null, packageCode: null, barcode: null, aliases: [], mxikStatus: 'ok' as const, mxikSuggestion: null, markingRequired: null };
    await upsertProducts(org.orgId, null, [
      { ...blank, name: 'Цемент М400 50кг', mxik: codes[0] ?? null, packageName: 'мешок', unit: 'мешок' },
      { ...blank, name: 'Арматура А500С 12мм', mxik: codes[1] ?? null, packageName: 'штук', unit: 'тонна' },
      { ...blank, name: 'Кирпич облицовочный красный', mxik: codes[2] ?? null, packageName: null, unit: 'тонна', barcode: brickBarcode },
      { ...blank, name: 'Гвозди 100мм', mxik: codes[4] ?? null, packageName: null, unit: 'кг' },
    ], org.userId, { source: 'manual' });
    // A package name comes with a Tasnif package code in the catalogue (upsertProducts keeps the pair); set it as an import would.
    await db.product.updateMany({ where: { orgId: org.orgId, name: 'Арматура А500С 12мм' }, data: { packageCode: '1500001', packageName: 'штук' } });
  });
  after(async () => {
    await dropOrgs([org.orgId]);
  });

  it('matches by name, reads the products, and flags MXIK conflict, package and unit against the catalogue', async () => {
    const doc = JSON.parse(readFileSync(join(FIXTURE_DIR, 'invoice-standard-3.json'), 'utf8')) as { productlist: { products: Array<Record<string, unknown> & { catalogcode: string }> } };
    const [cement, rebar, brick] = doc.productlist.products;
    if (!cement || !rebar || !brick) throw new Error('fixture');
    cement.catalogcode = codes[3] ?? ''; // another live code than the catalogue's
    rebar.catalogcode = codes[1] ?? '';
    brick.catalogcode = codes[2] ?? '';
    brick['barcode'] = brickBarcode; // matched by barcode, so the unit difference is ours to flag
    // Same name as a catalogue product, other unit: Agent 4 answers ambiguous and says why.
    doc.productlist.products.push({ ordno: 4, name: 'Гвозди 100мм', catalogcode: codes[4] ?? '', packagename: 'штук', count: 100, summa: 500, deliverysum: 50000, vatrate: 12, vatsum: 6000, deliverysumwithvat: 56000 });
    const parsed = parseDidoxDocument(doc, { source: 'didox_json' });
    assert.ok(parsed.ok);

    const checked = await checkInvoice(org.orgId, null, parsed.invoice, defaultDeps);
    const [c, r, b, nails] = checked.lines;
    assert.ok(c && r && b && nails);
    for (const line of [c, r, b]) {
      assert.equal(line.payload.product.status, 'matched', `${line.payload.name}: ${JSON.stringify(line.payload.product)}`);
      assert.ok(line.payload.resolved?.productId, 'the product read filled resolved');
    }
    const codesOf = (l: typeof c): string[] => l.issues.map((i) => i.code);
    assert.ok(codesOf(c).includes('mxik_conflict'), codesOf(c).join(','));
    assert.equal(c.issues.find((i) => i.code === 'mxik_conflict')?.suggestion, codes[0]);
    assert.ok(codesOf(r).includes('package_mismatch'), `"тонна" on the invoice, "штук" in the catalogue: ${codesOf(r).join(',')}`);
    assert.ok(codesOf(b).includes('unit_mismatch'), `"штук" on the invoice, "тонна" in the catalogue: ${codesOf(b).join(',')}`);
    assert.ok(!codesOf(r).includes('mxik_conflict'), 'same code as the catalogue');
    assert.equal(nails.payload.product.status, 'ambiguous', JSON.stringify(nails.payload.product));
    assert.ok(codesOf(nails).includes('product_ambiguous'));
    assert.ok(nails.payload.product.candidates[0]?.reason, 'the matcher says why (the unit differs)');
    // The seller is new to this org's counterparties (Agent 1's matcher answers "new").
    assert.deepEqual(checked.batchIssues.map((i) => i.code), ['seller_unknown']);
  });

  it("takes the classifier's issues for a broken or missing code instead of the parser's", async () => {
    const parsed = parseDidoxDocument(JSON.parse(readFileSync(join(FIXTURE_DIR, 'invoice-noisy.json'), 'utf8')), { source: 'didox_json' });
    assert.ok(parsed.ok);
    const checked = await checkInvoice(org.orgId, null, parsed.invoice, defaultDeps);
    const sugar = checked.lines[1];
    const flour = checked.lines[2];
    assert.ok(sugar && flour);
    // Sugar has no code: one mxik_missing (Agent 4's, with its suggestion when the classifier has one), not two.
    assert.equal(sugar.issues.filter((i) => i.code === 'mxik_missing').length, 1, JSON.stringify(sugar.issues));
    // Flour's 16-digit code: Agent 4 says mxik_malformed, the parser's mxik_invalid is dropped.
    assert.ok(flour.issues.some((i) => i.code === 'mxik_malformed'), JSON.stringify(flour.issues));
    assert.ok(!flour.issues.some((i) => i.code === 'mxik_invalid'));
    assert.equal(flour.status, 'unresolved');
    // A missing code with a suggestion carries its name and reason for the picker.
    const suggested = sugar.issues.find((i) => i.code === 'mxik_missing' && i.suggestion);
    if (suggested) assert.ok(suggested.params?.['suggestedName'], JSON.stringify(suggested));
    await db.$disconnect().catch(() => undefined);
  });
});
