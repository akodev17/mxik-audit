// The /products operations against the dev database with a fake Tasnif client: the list (search,
// status counts, client scope), "Confirm MXIK" (refusals, FirmMapping, re-check), chunked checks
// of unchecked products, and the drawer's packaging list.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { dictionaryKeys } from '@tasnivo/core/match/dictionary';
import { db } from '@tasnivo/db';
import type { CurrentUser } from '../session.js';
import { dbSkipReason, dropOrgs } from '../test-fixtures.js';
import { checkProducts, confirmProductMxik, listProducts, productDetail, productPackages } from './catalog.js';
import { getProducts } from './index.js';
import { useTasnifClient } from './tasnif-client.js';
import { FakeTasnifClient, PRODUCT_NAMES, RECORDED_CODE, seedProductOrg, type ProductOrg } from './test-fixtures.js';

const skip = await dbSkipReason();

describe('product catalogue operations (database, fake Tasnif)', { skip }, () => {
  let org: ProductOrg;
  let admin: CurrentUser;
  before(async () => {
    org = await seedProductOrg();
    admin = { userId: org.userId, orgId: org.orgId, email: 'a@test.local', demo: false, clientId: null, role: 'admin', clientIds: null };
    useTasnifClient(new FakeTasnifClient());
    // A cached list from an earlier live lookup would answer before the fake client.
    await db.packagingCode.deleteMany({ where: { mxikCode: RECORDED_CODE } });
    await db.mxikCodeState.deleteMany({ where: { code: RECORDED_CODE } });
  });
  after(async () => {
    useTasnifClient(null);
    await db.packagingCode.deleteMany({ where: { mxikCode: RECORDED_CODE } });
    await db.mxikCodeState.deleteMany({ where: { code: RECORDED_CODE } });
    if (org) await dropOrgs([org.orgId]);
  });

  it('lists with status counts, searches by name and by code, and pages', async () => {
    const all = await listProducts(admin, {});
    assert.equal(all.counts.all, 50);
    assert.equal(all.counts.ok + all.counts.missing, 50);
    assert.equal(all.rows.length, 50);
    const byName = await listProducts(admin, { q: 'coca-cola' });
    assert.equal(byName.total, 2);
    const byCode = await listProducts(admin, { q: org.codes[3] ?? '' });
    assert.ok(byCode.rows.some((r) => r.id === org.ids[18]));
    const byAlias = await listProducts(admin, { q: 'старое наименование' });
    assert.equal(byAlias.total, 5);
    const missing = await listProducts(admin, { status: 'missing' });
    assert.equal(missing.total, all.counts.missing);
    const own = await listProducts(admin, { client: org.clientId });
    assert.equal(own.total, 5);
  });

  it('shows a member scoped to a client only that client’s products', async () => {
    const scoped: CurrentUser = { ...admin, role: 'accountant', clientIds: [org.clientId] };
    const list = await listProducts(scoped, {});
    assert.equal(list.total, 5);
    assert.equal(await productDetail(scoped, org.ids[0] ?? ''), null);
    assert.ok(await productDetail(scoped, org.ids[41] ?? ''));
  });

  it('confirms an MXIK: refuses junk and dead codes, stores, re-checks and learns it', async () => {
    const id = org.ids[1] ?? '';
    assert.equal((await confirmProductMxik(admin, id, '123', 'ru')).ok, false);
    assert.equal((await confirmProductMxik(admin, id, '99999999999999999', 'ru')).ok, false);
    const viewer: CurrentUser = { ...admin, role: 'viewer' };
    assert.equal((await confirmProductMxik(viewer, id, org.codes[5] ?? '', 'ru')).ok, false);
    const ok = await confirmProductMxik(admin, id, org.codes[5] ?? '', 'ru');
    assert.ok(ok.ok, JSON.stringify(ok));
    assert.equal(ok.product.mxik, org.codes[5]);
    assert.ok(ok.product.confirmedAt);
    assert.notEqual(ok.product.mxikStatus, 'unchecked');
    const [name, unit] = PRODUCT_NAMES[1] ?? ['', ''];
    const learned = await db.firmMapping.findFirst({ where: { orgId: org.orgId, kind: 'name', key: dictionaryKeys({ rawName: name, unit }).name ?? '' } });
    assert.equal(learned?.code, org.codes[5]);
    const event = await db.auditEvent.findFirst({ where: { orgId: org.orgId, action: 'product.mxik_confirmed', targetId: id } });
    assert.ok(event);
  });

  it('checks unchecked products in chunks until none is left', async () => {
    await db.product.updateMany({ where: { orgId: org.orgId, id: { in: org.ids.slice(0, 3) } }, data: { mxikStatus: 'unchecked' } });
    const r = await checkProducts(admin, { unchecked: true }, 'ru');
    assert.equal(r.checked, 3);
    assert.equal(r.remaining, 0);
    const detail = await productDetail(admin, org.ids[2] ?? '');
    assert.notEqual(detail?.product.mxikStatus, 'unchecked');
    assert.ok(detail?.product.checkedAt);
  });

  it('lists the packaging codes of the product’s MXIK, and says none without a code', async () => {
    await db.product.update({ where: { id: org.ids[20] }, data: { mxik: RECORDED_CODE } });
    const pk = await productPackages(admin, org.ids[20] ?? '');
    // Another test file running in parallel may have cached the same recorded code a moment earlier.
    assert.ok(pk?.source === 'live' || pk?.source === 'cache', pk?.source);
    assert.deepEqual(pk?.packages.map((p) => p.code), ['1074787', '1070335', '1062101']);
    const none = await productPackages(admin, org.ids[30] ?? '');
    assert.equal(none?.source, 'none');
  });

  it('answers ProductRecords for ids, in order, and nothing for another org’s ids', async () => {
    const records = await getProducts(org.orgId, [org.ids[31] ?? '', 'nope', org.ids[15] ?? '']);
    assert.deepEqual(records.map((r) => r.productId), [org.ids[31], org.ids[15]]);
    assert.equal(records[1]?.mxik, org.codes[0]);
    assert.equal(records[1]?.unit, PRODUCT_NAMES[15]?.[1]);
    assert.deepEqual(records[0]?.aliases, [`${PRODUCT_NAMES[31]?.[0]} (старое наименование)`]);
    assert.deepEqual(await getProducts('another-org', [org.ids[0] ?? '']), []);
  });
});
