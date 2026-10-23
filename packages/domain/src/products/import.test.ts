// The product catalogue import: mapping (guess, the unverified 1C preset, remembered), and the whole
// flow against the dev database with a fake Tasnif client: preview → commit → chunked check →
// decisions → save → duplicate file; plus "Add to product catalogue" from an audit and the 1C stub.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { db } from '@tasnivo/db';
import type { CurrentUser } from '../session.js';
import { dbSkipReason, dropOrgs, liveCodes, makeCatalog, makeOrg } from '../test-fixtures.js';
import { exportProducts, productsFromAudit } from './catalog.js';
import { applyProductPreset, guessProductMapping, mappingProblem, namedMapping, PRODUCT_PRESETS, resolveNamed } from './import-map.js';
import { applyProductBatch, commitProductImport, decideProductRecord, previewProductImport, productBatchView, settleBatch, statusOfIssues } from './import.js';
import { useTasnifClient } from './tasnif-client.js';
import { FakeTasnifClient, RECORDED_CODE } from './test-fixtures.js';

const ONEC_HEADERS = ['Код', 'Наименование', 'Артикул', 'Единица измерения', 'Код из классификатора', 'Код упаковки', 'Штрихкод'];

describe('product import mapping', () => {
  it('guesses the 1C «Номенклатура» columns, "Код" as the 1C code and never as the name', () => {
    assert.deepEqual(guessProductMapping(ONEC_HEADERS), { onecRef: 0, name: 1, article: 2, unit: 3, mxik: 4, packageCode: 5, barcode: 6 });
  });

  it('guesses an Uzbek price list', () => {
    const m = guessProductMapping(['T/r', 'Mahsulot nomi', 'MXIK kodi', 'Qadoq kodi', 'Oʻlchov birligi', 'Shtrix kod', 'Narx']);
    assert.deepEqual([m.name, m.mxik, m.packageCode, m.unit, m.barcode, m.onecRef], [1, 2, 3, 4, 5, -1]);
  });

  it('applies the 1C preset, which stays unverified', () => {
    const preset = PRODUCT_PRESETS[0];
    assert.ok(preset);
    assert.equal(preset.verified, false);
    assert.deepEqual(applyProductPreset(preset, ONEC_HEADERS), { onecRef: 0, name: 1, article: 2, unit: 3, mxik: 4, packageCode: 5, barcode: 6 });
    assert.equal(applyProductPreset(preset, ['Nomi', 'MXIK']), null);
  });

  it('remembers a mapping by header name, in any column order', () => {
    const named = namedMapping(ONEC_HEADERS, { name: 1, mxik: 4, unit: 3, onecRef: -1 });
    assert.deepEqual(resolveNamed(named, ['Единица измерения', 'Код из классификатора', 'Наименование']), { name: 2, onecRef: -1, article: -1, mxik: 1, packageCode: -1, unit: 0, barcode: -1 });
    assert.equal(resolveNamed(named, ['Nomi']), null);
  });

  it('refuses a mapping without a name or with a column twice', () => {
    const ok = { name: 0, onecRef: -1, article: -1, mxik: 1, packageCode: -1, unit: -1, barcode: -1 };
    assert.equal(mappingProblem(ok, 2), null);
    assert.equal(mappingProblem({ ...ok, mxik: 0 }, 2), 'duplicate');
    assert.equal(mappingProblem({ ...ok, mxik: 5 }, 2), 'range');
  });

  it('reads record status from issue severities', () => {
    assert.equal(statusOfIssues([]), 'valid');
    assert.equal(statusOfIssues([{ code: 'marking_required', severity: 'info' }]), 'valid');
    assert.equal(statusOfIssues([{ code: 'unit_conflict', severity: 'warning' }]), 'suspicious');
    assert.equal(statusOfIssues([{ code: 'mxik_missing', severity: 'error' }, { code: 'unit_conflict', severity: 'warning' }]), 'unresolved');
  });
});

const skip = await dbSkipReason();

const csvFile = (name: string, rows: string[][]) => {
  const text = rows.map((r) => r.map((c) => (/[;"\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(';')).join('\r\n');
  const bytes = Buffer.from(`${String.fromCharCode(0xfeff)}${text}`, 'utf8');
  return { name, size: bytes.length, read: () => Promise.resolve(bytes) };
};

describe('product import flow (database, fake Tasnif)', { skip }, () => {
  let user: CurrentUser;
  let codes: string[];
  const fake = new FakeTasnifClient();
  before(async () => {
    const org = await makeOrg('internal');
    user = { userId: org.userId, orgId: org.orgId, email: 'x@test.local', demo: false, clientId: null, role: 'admin', clientIds: null };
    codes = await liveCodes(3);
    useTasnifClient(fake);
  });
  after(async () => {
    useTasnifClient(null);
    await db.packagingCode.deleteMany({ where: { mxikCode: RECORDED_CODE } });
    await db.mxikCodeState.deleteMany({ where: { code: RECORDED_CODE } });
    if (user) await dropOrgs([user.orgId]);
  });

  const rows = (): string[][] => [
    ONEC_HEADERS,
    ['00-001', 'Эторелекс таблетки 90 мг №14', 'ART-1', 'шт', RECORDED_CODE, '1074787', ''],
    ['00-002', 'Хлеб белый нарезной', '', 'шт', '', '', ''],
    ['00-003', 'Цемент М-400 50 кг', '', 'шт', '12345', '', ''],
    ['00-004', '', '', 'шт', '', '', ''],
    ['00-005', 'Живые лошади', '', 'шт', codes[0] ?? '', '', ''],
  ];

  it('previews with the 1C preset, imports, checks in the background and saves', async () => {
    const preview = await previewProductImport(user, 'ru', { file: csvFile('nomenklatura.csv', rows()), clientId: null });
    assert.ok(preview.ok, JSON.stringify(preview));
    assert.equal(preview.mappingSource, 'preset');
    assert.equal(preview.rowCount, 5);

    const commit = await commitProductImport(user, 'ru', { file: csvFile('nomenklatura.csv', rows()), clientId: null, mapping: JSON.stringify(preview.mapping) });
    assert.ok(commit.ok && !commit.duplicate, JSON.stringify(commit));
    await settleBatch(commit.batchId);
    const view = await productBatchView(user, commit.batchId, {});
    assert.ok(view);
    assert.equal(view.batch.status, 'review', view.batch.error ?? '');
    assert.deepEqual(view.batch.progress, { done: 4, total: 4 });
    assert.equal(view.batch.dropped, 1);
    const [etor, bread, cement, horse] = view.records;
    assert.equal(etor?.payload.mxikStatus, 'ok');
    assert.equal(etor?.payload.onecRef, '00-001');
    assert.match(etor?.payload.packageName ?? '', /упаковка/);
    assert.equal(bread?.payload.mxikStatus, 'missing');
    assert.equal(bread?.status, 'unresolved');
    assert.equal(cement?.payload.mxikStatus, 'invalid');
    assert.ok(cement?.issues.some((i) => i.code === 'mxik_malformed'));
    assert.equal(view.batch.counts?.total, 4);

    // Accept the bread's suggestion; skip the horses.
    const accepted = await decideProductRecord(user, commit.batchId, bread?.id ?? '', { action: 'accept_suggestion' }, 'ru');
    assert.ok(accepted.ok);
    assert.equal(accepted.record.status, 'corrected');
    assert.match(accepted.record.payload.mxik ?? '', /^\d{17}$/);
    const skipped = await decideProductRecord(user, commit.batchId, horse?.id ?? '', { action: 'skip' }, 'ru');
    assert.ok(skipped.ok && skipped.record.status === 'skipped');

    const applied = await applyProductBatch(user, commit.batchId, 'ru');
    assert.deepEqual(applied, { ok: true, created: 3, updated: 0 });
    const products = await db.product.findMany({ where: { orgId: user.orgId }, orderBy: { name: 'asc' } });
    assert.equal(products.length, 3);
    const breadProduct = products.find((p) => p.name === 'Хлеб белый нарезной');
    assert.ok(breadProduct?.mxikConfirmedAt, 'a code a person chose is confirmed');
    const learned = await db.firmMapping.count({ where: { orgId: user.orgId } });
    assert.equal(learned, 1);

    const again = await commitProductImport(user, 'ru', { file: csvFile('nomenklatura.csv', rows()), clientId: null, mapping: JSON.stringify(preview.mapping) });
    assert.deepEqual(again, { ok: true, batchId: commit.batchId, duplicate: true });

    // The next upload of the same layout remembers the mapping.
    const next = await previewProductImport(user, 'ru', { file: csvFile('other.csv', [ONEC_HEADERS, ['1', 'Товар', '', 'шт', '', '', '']]), clientId: null });
    assert.ok(next.ok && next.mappingSource === 'remembered');
  });

  it('adds a finished audit’s settled rows to the catalogue', async () => {
    const { catalogId, findingIds } = await makeCatalog(user.orgId, [
      { rawName: 'Аудит товар 1', unit: 'шт', suggestedMxik: codes[1] ?? null, confidence: 0.9 },
      { rawName: 'Аудит товар 2', unit: 'шт', suggestedMxik: codes[2] ?? null, confidence: 0.5 },
    ]);
    await db.finding.update({ where: { id: findingIds[0] }, data: { decision: 'accepted', chosenMxik: codes[1] ?? null, decidedAt: new Date() } });
    const out = await productsFromAudit(user, catalogId, 'ru');
    assert.deepEqual(out, { ok: true, created: 1, updated: 0, rows: 1 });
    const p = await db.product.findFirstOrThrow({ where: { orgId: user.orgId, name: 'Аудит товар 1' } });
    assert.equal(p.mxik?.trim(), codes[1]);
    assert.equal(p.source, 'audit');
  });

  it('says "after integration" while the 1C module is the stub, and leaves no batch behind', async () => {
    const before = await db.importBatch.count({ where: { orgId: user.orgId } });
    const out = await exportProducts(user, {}, 'ru');
    assert.equal(out.ok, false);
    assert.equal(!out.ok && out.unavailable, true);
    assert.equal(await db.importBatch.count({ where: { orgId: user.orgId } }), before);
  });
});
