// Integration: matchProducts, upsertProducts, the packaging cache and classifyProducts against the
// dev database and the loaded classifier, with a fake Tasnif client (never the network). Skips when
// the database or the classifier is not there.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { dictionaryKeys } from '@tasnivo/core/match/dictionary';
import { db } from '@tasnivo/db';
import { dbSkipReason, dropOrgs, liveCodes, makeOrg, type TestActor } from '../test-fixtures.js';
import { classifyDetailed, packagingIssues } from './classify.js';
import { classifyProducts, matchProducts, upsertProducts, type ProductRecord } from './index.js';
import { productNameKey } from './keys.js';
import { CANDIDATE_SIMILARITY, MATCH_SIMILARITY } from './match.js';
import { activityFor, packagesFor } from './packaging.js';
import { DisabledTasnifClient } from './tasnif-client.js';
import { FakeTasnifClient, gtin13, PRODUCT_NAMES, RECORDED_CODE, seedProductOrg, type ProductOrg } from './test-fixtures.js';

const skip = await dbSkipReason();
/** A restricted code already in force, when the list is loaded (npm run load:restricted). */
const restricted = skip ? null : await db.restrictedCode.findFirst({ where: { effectiveFrom: { lte: new Date() } }, select: { code: true, effectiveFrom: true } });

const record = (over: Partial<ProductRecord> & { name: string }): ProductRecord => ({
  productId: null, onecRef: null, mxik: null, mxikName: null, packageCode: null, packageName: null, unit: null, barcode: null,
  aliases: [], mxikStatus: 'unchecked', mxikSuggestion: null, markingRequired: null, ...over,
});

describe('matchProducts (database, 50 seeded products)', { skip }, () => {
  let org: ProductOrg;
  before(async () => { org = await seedProductOrg(); });
  after(async () => { if (org) await dropOrgs([org.orgId]); });

  it('matches by 1C reference first', async () => {
    const [r] = await matchProducts(org.orgId, null, [{ name: 'совсем другое имя', onecRef: '00-000020' }]);
    assert.equal(r?.status, 'matched');
    assert.equal(r?.chosen?.basis, 'onec_ref');
    assert.equal(r?.chosen?.id, org.ids[10]);
  });

  it('matches a GTIN-checked barcode, and ignores one that fails the check digit', async () => {
    const good = org.barcodes[3] ?? '';
    const [hit, miss] = await matchProducts(org.orgId, null, [
      { name: 'unknown name', barcode: good },
      { name: 'unknown name', barcode: `${good.slice(0, 12)}${(Number(good.slice(12)) + 1) % 10}` },
    ]);
    assert.equal(hit?.chosen?.basis, 'barcode');
    assert.equal(hit?.chosen?.id, org.ids[3]);
    assert.notEqual(miss?.status, 'matched');
  });

  it('matches MXIK + unit only when the names are close', async () => {
    const code = org.codes[0] ?? '';
    const [close, far] = await matchProducts(org.orgId, null, [
      { name: 'Краска водоэмульсионная белая, 10кг', mxik: code, unit: 'шт' },
      { name: 'Совершенно другой товар', mxik: code, unit: 'шт' },
    ]);
    assert.equal(close?.status, 'matched');
    assert.equal(close?.chosen?.id, org.ids[15]);
    assert.ok(close?.chosen?.basis === 'mxik' || close?.chosen?.basis === 'name_normalized');
    assert.notEqual(far?.chosen?.id, org.ids[25], 'a shared code alone never decides');
    assert.notEqual(far?.status, 'matched');
  });

  it('matches the exact and the normalised name', async () => {
    const [exact, folded] = await matchProducts(org.orgId, null, [
      { name: 'Хлеб белый нарезной 400 г', unit: 'шт' },
      { name: 'хлеб  БЕЛЫЙ нарезной 400г', unit: 'dona' },
    ]);
    assert.equal(exact?.chosen?.basis, 'name_exact');
    assert.equal(folded?.chosen?.basis, 'name_normalized');
    assert.equal(folded?.chosen?.id, org.ids[0]);
  });

  it('matches an alias', async () => {
    const [r] = await matchProducts(org.orgId, null, [{ name: `${PRODUCT_NAMES[31]?.[0]} (старое наименование)`, unit: PRODUCT_NAMES[31]?.[1] }]);
    assert.equal(r?.chosen?.basis, 'alias');
    assert.equal(r?.chosen?.id, org.ids[31]);
  });

  it('matches through a confirmed FirmMapping code', async () => {
    const [r] = await matchProducts(org.orgId, null, [{ name: org.confirmed.name, unit: org.confirmed.unit }]);
    assert.equal(r?.status, 'matched');
    assert.equal(r?.chosen?.basis, 'confirmed_mapping');
    assert.equal(r?.chosen?.id, org.ids[org.confirmed.productIndex]);
  });

  it('never matches a different size by similarity, and calls it ambiguous', async () => {
    const [r] = await matchProducts(org.orgId, null, [{ name: 'Coca-Cola 1 л', unit: 'шт' }]);
    assert.notEqual(r?.status, 'matched');
    assert.equal(r?.status, 'ambiguous');
    assert.ok((r?.candidates.length ?? 0) >= 2 && (r?.candidates.length ?? 0) <= 5);
    assert.ok(r?.candidates.every((c) => c.reason));
  });

  it('matches a close spelling by similarity with a clear winner', async () => {
    const [r] = await matchProducts(org.orgId, null, [{ name: 'Мышь беспроводная Logitech M-185', unit: 'шт' }]);
    assert.equal(r?.status, 'matched', JSON.stringify(r));
    assert.equal(r?.chosen?.id, org.ids[31]);
    assert.ok((r?.chosen?.confidence ?? 0) >= MATCH_SIMILARITY);
  });

  it('says new when nothing is plausible', async () => {
    const [r] = await matchProducts(org.orgId, null, [{ name: 'Вертолёт Ми-8', unit: 'шт' }]);
    assert.deepEqual(r, { status: 'new', chosen: null, candidates: [] });
    assert.ok(CANDIDATE_SIMILARITY < MATCH_SIMILARITY);
  });

  it('sees the client’s own products only under that client', async () => {
    const name = PRODUCT_NAMES[41]?.[0] ?? '';
    const [org0] = await matchProducts(org.orgId, null, [{ name, unit: 'шт' }]);
    const [own] = await matchProducts(org.orgId, org.clientId, [{ name, unit: 'шт' }]);
    assert.notEqual(org0?.chosen?.id, org.ids[41]);
    assert.equal(own?.chosen?.id, org.ids[41]);
  });

  it('answers 1 000 lines in order', async () => {
    const lines = Array.from({ length: 1000 }, (_, i) => ({ name: PRODUCT_NAMES[i % 50]?.[0] ?? '', unit: PRODUCT_NAMES[i % 50]?.[1] ?? null }));
    const out = await matchProducts(org.orgId, org.clientId, lines);
    assert.equal(out.length, 1000);
    assert.equal(out[7]?.chosen?.id, org.ids[7]);
    assert.equal(out[57]?.chosen?.id, org.ids[7]);
  });
});

describe('upsertProducts (database)', { skip }, () => {
  let actor: TestActor;
  let code: string;
  before(async () => { actor = await makeOrg('internal'); [code = ''] = await liveCodes(1); });
  after(async () => { if (actor) await dropOrgs([actor.orgId]); });

  it('creates, then merges by identity without blanking a field', async () => {
    const barcode = gtin13('478999000001');
    const first = await upsertProducts(actor.orgId, null, [record({ name: 'Чай чёрный 100 г', unit: 'шт', mxik: code, mxikName: 'Чай', barcode, onecRef: 'A-1', packageCode: '123', packageName: 'коробка' })], actor.userId);
    assert.equal(first.created, 1);
    const second = await upsertProducts(actor.orgId, null, [record({ name: 'ЧАЙ  чёрный 100г', unit: 'dona', mxik: null, barcode: '', onecRef: null, packageCode: null })], actor.userId);
    assert.deepEqual([second.created, second.updated, second.ids[0]], [0, 1, first.ids[0]]);
    const p = await db.product.findUniqueOrThrow({ where: { id: first.ids[0] }, include: { aliases: true } });
    assert.equal(p.mxik?.trim(), code);
    assert.equal(p.mxikName, 'Чай');
    assert.equal(p.barcode, `0${barcode}`);
    assert.equal(p.onecRef, 'A-1');
    assert.equal(p.packageCode, '123');
    assert.equal(p.packageName, 'коробка');
    assert.deepEqual(p.aliases.map((a) => a.alias), ['ЧАЙ  чёрный 100г']);
  });

  it('updates a non-empty field with a new non-empty value', async () => {
    const [codeB = ''] = (await liveCodes(2)).slice(1);
    const a = await upsertProducts(actor.orgId, null, [record({ name: 'Кофе молотый', unit: 'кг', mxik: code })], actor.userId);
    await upsertProducts(actor.orgId, null, [record({ productId: a.ids[0] ?? null, name: 'Кофе молотый', unit: 'кг', mxik: codeB, mxikStatus: 'ok' })], actor.userId);
    const p = await db.product.findUniqueOrThrow({ where: { id: a.ids[0] } });
    assert.equal(p.mxik?.trim(), codeB);
    assert.equal(p.mxikStatus, 'ok');
  });

  it('keeps two sizes as two products, and records that fold together as one', async () => {
    const r = await upsertProducts(actor.orgId, null, [
      record({ name: 'Сок 1 л', unit: 'шт' }), record({ name: 'Сок 0,2 л', unit: 'шт' }), record({ name: 'сок 1л', unit: 'шт', aliases: ['Juice 1L'] }),
    ], actor.userId);
    // The third record merges into the product the first one created in this same call.
    assert.deepEqual([r.created, r.updated], [2, 0]);
    assert.equal(r.ids[0], r.ids[2]);
    const aliases = await db.productAlias.findMany({ where: { productId: r.ids[0] } });
    assert.ok(aliases.some((x) => x.normalizedAlias === productNameKey('Juice 1L')));
  });

  it('writes a confirmed MXIK to FirmMapping, and an unconfirmed one not', async () => {
    await upsertProducts(actor.orgId, null, [record({ name: 'Печенье овсяное', unit: 'кг', mxik: code })], actor.userId, { confirmed: new Set([0]) });
    await upsertProducts(actor.orgId, null, [record({ name: 'Печенье шоколадное', unit: 'кг', mxik: code })], actor.userId);
    const keyOf = (name: string): string => dictionaryKeys({ rawName: name, unit: 'кг' }).name ?? '';
    const learned = await db.firmMapping.findMany({ where: { orgId: actor.orgId, kind: 'name' } });
    const confirmed = learned.find((m) => m.key === keyOf('Печенье овсяное'));
    assert.equal(confirmed?.code, code);
    assert.equal(confirmed?.confirmations, 1);
    assert.equal(learned.some((m) => m.key === keyOf('Печенье шоколадное')), false);
    const p = await db.product.findFirstOrThrow({ where: { orgId: actor.orgId, normalizedName: productNameKey('Печенье овсяное') } });
    assert.ok(p.mxikConfirmedAt);
  });

  it('skips a record without a name and keeps the ids aligned', async () => {
    const r = await upsertProducts(actor.orgId, null, [record({ name: '  ' }), record({ name: 'Вафли' })], actor.userId);
    assert.equal(r.ids.length, 2);
    assert.equal(r.ids[0], '');
    assert.ok(r.ids[1]);
  });
});

describe('packaging cache (database, fake Tasnif)', { skip }, () => {
  const cleanup = async (): Promise<void> => {
    await db.packagingCode.deleteMany({ where: { mxikCode: RECORDED_CODE } });
    await db.mxikCodeState.deleteMany({ where: { code: RECORDED_CODE } });
  };
  before(cleanup);
  after(cleanup);

  it('fetches a code once, then answers from the table', async () => {
    const client = new FakeTasnifClient();
    const first = await packagesFor([RECORDED_CODE], client);
    assert.equal(first.get(RECORDED_CODE)?.source, 'live');
    assert.equal(first.get(RECORDED_CODE)?.packages.length, 3);
    const again = await packagesFor([RECORDED_CODE], client);
    assert.equal(again.get(RECORDED_CODE)?.source, 'cache');
    assert.equal(client.calls.card, 1);
    const stored = await db.packagingCode.findUniqueOrThrow({ where: { code: '1074787' } });
    assert.match(stored.nameRu ?? '', /^упаковка=1 флакон/);
    const activity = await activityFor([RECORDED_CODE]);
    assert.equal(activity.get(RECORDED_CODE)?.isActive, true);
  });

  it('says unavailable when the switch is off or the API is down, and caches nothing', async () => {
    await cleanup();
    const off = await packagesFor([RECORDED_CODE], new DisabledTasnifClient());
    assert.deepEqual(off.get(RECORDED_CODE), { source: 'unavailable', packages: [], reason: 'disabled' });
    const down = new FakeTasnifClient();
    down.down = true;
    assert.equal((await packagesFor([RECORDED_CODE], down)).get(RECORDED_CODE)?.reason, 'unavailable');
    assert.equal(await db.mxikCodeState.count({ where: { code: RECORDED_CODE } }), 0);
  });

  it('checks a package code against the code’s list and its unit', () => {
    const state = { source: 'cache' as const, packages: [
      { code: '1074787', parentCode: '1070335', mxikCode: RECORDED_CODE, containerCode: 58, containerName: 'упаковка', unitId: 1, unitName: 'шт.', parentValue: 1, name: '1 флакон', type: '1', isUnitPackage: '2', nameUz: null, nameRu: 'упаковка=1 флакон' },
    ] };
    assert.deepEqual(packagingIssues({ packageCode: '1074787', unit: 'шт' }, RECORDED_CODE, state), { issues: [], packageName: 'упаковка=1 флакон' });
    assert.equal(packagingIssues({ packageCode: '1074787', unit: 'кг' }, RECORDED_CODE, state).issues[0]?.code, 'package_unit_conflict');
    assert.equal(packagingIssues({ packageCode: '42', unit: 'шт' }, RECORDED_CODE, state).issues[0]?.code, 'package_not_of_code');
    const missing = packagingIssues({ packageCode: null, unit: 'шт' }, RECORDED_CODE, state).issues[0];
    assert.equal(missing?.code, 'package_missing');
    assert.equal(missing?.suggestion, '1074787');
    assert.equal(packagingIssues({ packageCode: '1', unit: 'шт' }, RECORDED_CODE, { source: 'unavailable', packages: [], reason: 'disabled' }).issues[0]?.code, 'package_unchecked');
  });
});

describe('classifyProducts (database + classifier, fake Tasnif)', { skip }, () => {
  let actor: TestActor;
  const inactive = '00101001001000000';
  before(async () => {
    actor = await makeOrg('internal');
    await db.mxikCodeState.upsert({ where: { code: inactive }, create: { code: inactive, isActive: false, apiStatus: 1, statusFetchedAt: new Date() }, update: { isActive: false, apiStatus: 1, statusFetchedAt: new Date() } });
  });
  after(async () => {
    await db.mxikCodeState.deleteMany({ where: { code: { in: [inactive, RECORDED_CODE] } } });
    await db.packagingCode.deleteMany({ where: { mxikCode: RECORDED_CODE } });
    if (actor) await dropOrgs([actor.orgId]);
  });

  it('labels every line and keeps the order', async () => {
    const client = new FakeTasnifClient();
    const lines = [
      { name: 'Эторелекс таблетки 90 мг №14', mxik: RECORDED_CODE, unit: 'шт', packageCode: '1074787' },
      { name: 'Хлеб белый', unit: 'шт' },
      { name: 'Хлеб белый', mxik: '1234', unit: 'шт' },
      { name: 'Хлеб белый', mxik: '99999999999999999', unit: 'шт' },
      { name: 'Живые лошади', mxik: inactive, unit: 'шт' },
      { name: 'Эторелекс таблетки 90 мг №14', mxik: RECORDED_CODE, unit: 'кг', packageCode: '42' },
    ];
    const out = await classifyDetailed(actor.orgId, lines, { client, locale: 'ru' });
    assert.equal(out.length, lines.length);
    const [ok, missing, malformed, notFound, off, bad] = out;
    assert.equal(ok?.mxikStatus, 'ok');
    assert.match(ok?.packageName ?? '', /^упаковка=1 флакон/);
    assert.equal(ok?.markingRequired, true);
    assert.equal(missing?.mxikStatus, 'missing');
    assert.ok(missing?.mxikSuggestion?.id.match(/^\d{17}$/));
    assert.ok(missing?.mxikSuggestion?.reason);
    assert.ok((missing?.alternatives.length ?? 0) > 0);
    assert.equal(malformed?.mxikStatus, 'invalid');
    assert.equal(malformed?.issues[0]?.code, 'mxik_malformed');
    assert.equal(notFound?.mxikStatus, 'invalid');
    assert.ok(notFound?.issues.some((i) => i.code === 'mxik_not_found' && i.severity === 'error'));
    assert.equal(off?.mxikStatus, 'inactive');
    assert.ok(off?.issues.some((i) => i.code === 'mxik_inactive_api'));
    assert.ok(bad?.issues.some((i) => i.code === 'unit_conflict'));
    assert.ok(bad?.issues.some((i) => i.code === 'package_not_of_code'));
    assert.equal(client.calls.card, 1, 'one fetch per code, cached afterwards');
  });

  it('flags a restricted code in force as an error with a replacement', { skip: restricted === null ? 'no restricted code loaded' : false }, async () => {
    if (!restricted) return;
    const [r] = await classifyProducts(actor.orgId, [{ name: 'Песок строительный', mxik: restricted.code, unit: 'тонна' }], { client: new FakeTasnifClient() });
    assert.equal(r?.mxikStatus, 'restricted');
    const issue = r?.issues.find((i) => i.code === 'mxik_restricted');
    assert.equal(issue?.severity, 'error');
    if (r?.mxikSuggestion) assert.notEqual(r.mxikSuggestion.id, restricted.code);
  });

  it('suggests the firm dictionary’s confirmed code first', async () => {
    const [code = ''] = (await liveCodes(5)).slice(4);
    await upsertProducts(actor.orgId, null, [record({ name: 'Товар из словаря', unit: 'шт', mxik: code })], actor.userId, { confirmed: 'all' });
    const [r] = await classifyProducts(actor.orgId, [{ name: 'Товар из словаря', unit: 'шт' }], { client: new FakeTasnifClient() });
    assert.equal(r?.mxikSuggestion?.id, code);
    assert.equal(r?.mxikSuggestion?.basis, 'confirmed_mapping');
  });
});
