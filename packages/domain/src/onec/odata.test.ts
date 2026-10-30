// The OData client against a fake 1C built from real saved responses (fixtures/odata/SOURCES.md),
// one test per item of the research checklist (tmp/real-docs/onec/RESEARCH.md §8.25–38). The
// client tests need no database; the transfer tests at the end do (skipped without it).
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { db } from '@tasnivo/db';
import { dropOrgs, makeOrg, type TestActor } from '../test-fixtures.js';
import { DEFAULT_OBJECT_MAP, invoiceDocument, resolveMap, saveConnection, writeRef, type DocumentJob } from './connection.js';
import { BANK_TRANSACTIONS, INVOICE_LINES, INVOICE_META, OUR_ACCOUNT } from './fixtures/demo-data.js';
import { BP_UZ_SPEC, FakeOData, metadataXml, sample, sampleJson, startFakeOData, type MetadataSpec } from './fixtures/odata/fake-server.js';
import { seedBankBatch, seedInvoiceBatch } from './fixtures/seed.js';
import { transferExport } from './index.js';
import {
  bodyDate, castRef, datetime, discover, ODATA_ERROR_CODES, ODataClient, parseMetadata, parseODataError, reasonOf, withoutKeys, type Metadata,
} from './odata.js';

const creds = (fake: FakeOData) => ({ baseUrl: fake.base, username: 'odata', password: 's3cret' });
const without = (spec: MetadataSpec, drop: (s: MetadataSpec) => void): MetadataSpec => {
  const copy = structuredClone(spec);
  drop(copy);
  return copy;
};
const hasRefKey = (body: unknown): boolean => JSON.stringify(body).includes('"Ref_Key"');

describe('OData client against a fake 1C built from real responses', () => {
  let fake: FakeOData;
  let client: ODataClient;
  let md: Metadata;

  before(async () => {
    fake = await startFakeOData();
    client = new ODataClient(creds(fake));
    const d = await discover(client);
    assert.ok(d.ok);
    md = d.md;
  });
  after(() => fake.close());

  it('names come from the base\'s $metadata, resolved per base and cached by its hash (onec §8.34)', async () => {
    // onec §8.34: `Catalog_КлассификаторЕдиницИзмерения` (RU BP 3.0) vs `Catalog_ЕдиницыИзмерения`: discovered, never assumed.
    const metadataReads = () => fake.seen.filter((s) => s.path === '$metadata').length;
    const again = await discover(client);
    assert.ok(again.ok && again.cached, 'the second read within 10 minutes comes from the cache');
    assert.equal(metadataReads(), 1);
    const r = resolveMap(DEFAULT_OBJECT_MAP, md);
    assert.deepEqual(r.problems.filter((p) => p.required), []);
    assert.equal(r.map.product.refs?.['unit']?.entitySet, 'Catalog_КлассификаторЕдиницИзмерения');
    assert.equal(r.map.invoice.entitySet, 'Document_ПоступлениеТоваровУслуг');

    const other = await startFakeOData({
      spec: without(BP_UZ_SPEC, (s) => {
        s['Catalog_ЕдиницыИзмерения'] = s['Catalog_КлассификаторЕдиницИзмерения']!;
        delete s['Catalog_КлассификаторЕдиницИзмерения'];
      }),
    });
    try {
      const d = await discover(new ODataClient(creds(other)));
      assert.ok(d.ok);
      assert.notEqual(d.md.hash, md.hash, 'another composition, another hash');
      const r2 = resolveMap(DEFAULT_OBJECT_MAP, d.md);
      assert.equal(r2.map.product.refs?.['unit']?.entitySet, 'Catalog_ЕдиницыИзмерения');
      assert.deepEqual(r2.renamed, { Catalog_КлассификаторЕдиницИзмерения: 'Catalog_ЕдиницыИзмерения' });
      assert.equal(parseMetadata(other.metadata).hash, d.md.hash);
    } finally {
      await other.close();
    }
  });

  it('a gap in the composition is named, set by set and attribute by attribute; a 403 is not "wrong password" (onec §8.25)', async () => {
    // onec §8.25: the composition is empty by default and a 1C update can add an attribute that is not published yet.
    const spec = without(BP_UZ_SPEC, (s) => {
      delete s['Catalog_ДоговорыКонтрагентов'];
      s['Document_ПоступлениеТоваровУслуг']!.parts!['Товары'] = s['Document_ПоступлениеТоваровУслуг']!.parts!['Товары']!.filter((p) => p !== 'СуммаНДС');
      s['Document_СписаниеСРасчетногоСчета']!.props = s['Document_СписаниеСРасчетногоСчета']!.props.filter((p) => p !== 'ВидОперации');
    });
    const r = resolveMap(DEFAULT_OBJECT_MAP, parseMetadata(metadataXml(spec)));
    const named = r.problems.map((p) => [p.kind, p.entitySet, p.attribute ?? '', p.required]);
    assert.deepEqual(named.filter((p) => p[3] === true), [
      ['attribute_missing', 'Document_СписаниеСРасчетногоСчета', 'ВидОперации', true],
      ['attribute_missing', 'Document_ПоступлениеТоваровУслуг', 'Товары.СуммаНДС', true],
    ]);
    assert.ok(named.some((p) => p[0] === 'ref_missing' && p[1] === 'Catalog_ДоговорыКонтрагентов' && p[3] === false), 'a missing reference catalogue leaves the reference empty');

    fake.unpublished.add('Catalog_Номенклатура');
    const refused = await client.create(md, 'Catalog_Номенклатура', { Description: 'Сахар-песок 50 кг' });
    fake.unpublished.delete('Catalog_Номенклатура');
    assert.ok(!refused.ok);
    assert.equal(refused.status, 403);
    assert.equal(refused.reason, 'forbidden_or_not_published');
    assert.match(refused.message ?? '', /не включен в состав/);
    assert.equal(reasonOf(403, 20), 'access_denied');
    assert.equal(reasonOf(401, null), 'auth_failed');
  });

  it('one POST creates the receipt with two goods and a service line, no Ref_Key anywhere, rows read back (onec §8.27)', async () => {
    // onec §8.27: rows go inside the document's own POST; a row's Ref_Key leaves the table empty (mista 828664); never Document_X_Товары.
    const lines = [INVOICE_LINES[0]!, INVOICE_LINES[1]!, INVOICE_LINES[3]!];
    const job = invoiceDocument(DEFAULT_OBJECT_MAP, INVOICE_META, lines, false);
    const rows = job.body['Товары'] as Record<string, unknown>[];
    rows[0]!['Ref_Key'] = '83a6f31f-e809-11e8-8cd3-50465d037106';
    job.body['Ref_Key'] = 'baebad03-b80e-11e4-826f-001e101fe696';
    const before = fake.writes().length;
    const created = await client.create(md, job.entitySet, job.body);
    assert.ok(created.ok, JSON.stringify(created));
    const writes = fake.writes().slice(before);
    assert.equal(writes.length, 1, 'one request for the document and its rows');
    assert.equal(writes[0]?.path, 'Document_ПоступлениеТоваровУслуг');
    assert.ok(!hasRefKey(writes[0]?.body), 'no Ref_Key on the document or on a row');
    assert.deepEqual((writes[0]?.body?.['Товары'] as { LineNumber: string }[]).map((r) => r.LineNumber), ['1', '2', '3']);
    assert.equal((created.json?.['Товары'] as unknown[]).length, 3);
    assert.equal(created.json?.['Posted'], false, 'OData creates documents unposted');

    // The real working body of the mista thread goes through as it is.
    const mista = await client.create(md, 'Document_ПоступлениеТоваровУслуг', sampleJson('mista-post-body.json'));
    assert.ok(mista.ok);
    // The failing one (rows with Ref_Key) is repaired before it is sent: both rows arrive.
    const repaired = await client.create(md, 'Document_ПоступлениеТоваровУслуг', sampleJson('mista-post-row-keys.json'));
    assert.ok(repaired.ok);
    assert.equal((repaired.json?.['Товары'] as unknown[]).length, 2);
    // Sent raw, the same body leaves the table empty, as the thread reports.
    const raw = await client.call('POST', 'Document_ПоступлениеТоваровУслуг?$format=json', sampleJson('mista-post-row-keys.json'));
    assert.ok(raw.ok);
    assert.deepEqual(raw.json?.['Товары'], []);
    assert.ok(!hasRefKey(withoutKeys(sampleJson('mista-post-row-keys.json'))));

    // A base that drops the rows is caught by reading them back.
    fake.loseRows = true;
    const lost = await client.create(md, job.entitySet, job.body);
    fake.loseRows = false;
    assert.ok(!lost.ok);
    assert.equal(lost.reason, 'rows_lost');
    // A tabular part's own set is refused before any request; 1C answers code 13 if asked anyway.
    const count = fake.seen.length;
    const direct = await client.create(md, 'Document_ПоступлениеТоваровУслуг_Товары', { LineNumber: '1', Количество: 1 });
    assert.ok(!direct.ok);
    assert.equal(direct.code, 13);
    assert.equal(fake.seen.length, count);
    const asked = await client.call('POST', `${encodeURIComponent('Document_ПоступлениеТоваровУслуг_Товары')}?$format=json`, { Количество: 1 });
    assert.ok(!asked.ok);
    assert.equal(asked.reason, 'onec_rows_direct');
  });

  it('documents are created unposted; Post() is its own call and a 500 is 1C refusing, in its own words (onec §8.28)', async () => {
    // onec §8.28: «приложение может, исходя из своей бизнес-логики, отказать в проведении … ответ с HTTP-кодом 500» (1C:Fresh §6.5.1).
    const created = await client.create(md, 'Document_ПоступлениеНаРасчетныйСчет', { Date: '2026-10-01T00:00:00', СуммаДокумента: 15000000 });
    assert.ok(created.ok && created.ref);
    const ref = created.ref;
    const stored = () => fake.store.get('Document_ПоступлениеНаРасчетныйСчет')!.find((o) => o['Ref_Key'] === ref)!;
    assert.equal(stored()['Posted'], false);
    const posted = await client.post('Document_ПоступлениеНаРасчетныйСчет', ref);
    assert.ok(posted.ok);
    assert.equal(stored()['Posted'], true);
    assert.equal(fake.seen.at(-1)?.path, `Document_ПоступлениеНаРасчетныйСчет(guid'${ref}')/Post()`);

    fake.postRefusal = 'Не заполнено поле "Счет учета"';
    const refused = await client.post('Document_ПоступлениеНаРасчетныйСчет', ref);
    fake.postRefusal = null;
    assert.ok(!refused.ok);
    assert.equal(refused.status, 500);
    assert.equal(refused.reason, 'post_refused');
    assert.equal(refused.message, 'Не заполнено поле "Счет учета"');
  });

  it('PATCH resends the whole tabular part with If-Match: DataVersion; a 412 reads again and retries (onec §8.29)', async () => {
    // onec §8.29: «Табличную часть следует передавать полностью» (42clouds) and optimistic locking by DataVersion.
    const created = await client.create(md, 'Document_ПоступлениеТоваровУслуг', invoiceDocument(DEFAULT_OBJECT_MAP, INVOICE_META, INVOICE_LINES).body);
    assert.ok(created.ok && created.ref);
    const rows = (created.json?.['Товары'] as Record<string, unknown>[]).map((r) => ({ ...r }));
    rows[0]!['Количество'] = 12;
    fake.concurrentEdits = 1;
    const before = fake.seen.length;
    const updated = await client.update('Document_ПоступлениеТоваровУслуг', created.ref, { Товары: rows });
    assert.ok(updated.ok, JSON.stringify(updated));
    assert.equal(updated.attempts, 2, 'the first PATCH met a 412, the second went through');
    const patches = fake.seen.slice(before).filter((s) => s.method === 'PATCH');
    assert.equal(patches.length, 2);
    assert.ok(patches.every((p) => typeof p.headers['if-match'] === 'string' && p.headers['if-match'].length > 0));
    assert.notEqual(patches[0]?.headers['if-match'], patches[1]?.headers['if-match'], 'the retry carries the re-read version');
    assert.equal((patches[1]?.body?.['Товары'] as unknown[]).length, 4, 'every row, not only the changed one');
    const stored = fake.store.get('Document_ПоступлениеТоваровУслуг')!.find((o) => o['Ref_Key'] === created.ref)!;
    assert.equal((stored['Товары'] as { Количество: number }[])[0]?.Количество, 12);
    assert.equal((stored['Товары'] as unknown[]).length, 4);

    fake.concurrentEdits = 5;
    const gaveUp = await client.update('Document_ПоступлениеТоваровУслуг', created.ref, { Комментарий: 'x' }, 2);
    fake.concurrentEdits = 0;
    assert.ok(!gaveUp.ok);
    assert.equal(gaveUp.reason, 'version_conflict');
  });

  it('deleting is DeletionMark=true by PATCH; the client has no DELETE (onec §8.30)', async () => {
    // onec §8.30: an OData DELETE removes the object physically, without a mark (1C:Fresh §6.3.6).
    const created = await client.create(md, 'Catalog_Номенклатура', { Description: 'Удаляемый товар' });
    assert.ok(created.ok && created.ref);
    const marked = await client.markDeleted('Catalog_Номенклатура', created.ref);
    assert.ok(marked.ok);
    const stored = fake.store.get('Catalog_Номенклатура')!.find((o) => o['Ref_Key'] === created.ref);
    assert.equal(stored?.['DeletionMark'], true, 'still in the base, marked');
    assert.equal(fake.seen.filter((s) => s.method === 'DELETE').length, 0);
    await assert.rejects(client.call('DELETE' as 'GET', `Catalog_Номенклатура(guid'${created.ref}')`), /never deleted physically/);
  });

  it('a 10 000-item catalogue is read completely: $top/$skip/$inlinecount, no folders, allowedOnly after a 401 (onec §8.31)', async () => {
    // onec §8.31: paging, `IsFolder eq false`, and record-level restrictions answering 401 without allowedOnly=true.
    fake.seed('Catalog_Контрагенты', Array.from({ length: 10_000 }, (_, i) => ({ IsFolder: false, Description: `Контрагент ${i}`, ИНН: String(300_000_000 + i) })));
    fake.seed('Catalog_Контрагенты', [{ IsFolder: true, Description: 'Покупатели' }, { IsFolder: true, Description: 'Поставщики' }]);
    fake.seed('Catalog_Контрагенты', [{ IsFolder: false, Description: 'Помеченный', DeletionMark: true }]);
    const before = fake.seen.length;
    const all = await client.listAll('Catalog_Контрагенты', { folders: true, select: ['Ref_Key', 'Description', 'ИНН'], pageSize: 1000 });
    assert.ok(all.ok);
    assert.equal(all.rows.length, 10_000);
    assert.equal(all.count, 10_000);
    assert.equal(new Set(all.rows.map((r) => r['Ref_Key'])).size, 10_000, 'no page overlaps another');
    const pages = fake.seen.slice(before);
    assert.equal(pages.length, 10);
    assert.equal(pages[0]?.query.get('$inlinecount'), 'allpages');
    assert.equal(pages[3]?.query.get('$skip'), '3000');
    assert.match(pages[0]?.query.get('$filter') ?? '', /IsFolder eq false and DeletionMark eq false/);

    fake.rls.add('Catalog_Номенклатура');
    fake.seed('Catalog_Номенклатура', [{ Description: 'Видимый' }, { Description: 'Скрытый', _restricted: true }]);
    const restricted = await client.page('Catalog_Номенклатура', { filter: "Description eq 'Видимый'", top: 10 });
    fake.rls.delete('Catalog_Номенклатура');
    assert.ok(restricted.ok);
    assert.deepEqual(restricted.rows.map((r) => r['Description']), ['Видимый']);
    assert.equal(fake.seen.at(-2)?.query.get('allowedOnly'), null);
    assert.equal(fake.seen.at(-1)?.query.get('allowedOnly'), 'true');
  });

  it('composite references are written with their type and filtered with cast(guid\'…\', \'Catalog_X\') (onec §8.32)', async () => {
    // onec §8.32: a bank document's Контрагент may be a counterparty or a person; $metadata shows it as Контрагент + Контрагент_Type.
    const [cp] = fake.seed('Catalog_Контрагенты', [{ Description: 'ООО "Ромашка Савдо"', ИНН: '301234567' }]);
    const job: DocumentJob = { entitySet: 'Document_ПоступлениеНаРасчетныйСчет', body: { СуммаДокумента: 1 }, needs: [], notes: [] };
    const need = { name: 'counterparty', ref: DEFAULT_OBJECT_MAP.bankCredit.refs!['counterparty']!, value: '301234567', line: null };
    assert.ok(writeRef(md, job, undefined, need, String(cp!['Ref_Key'])));
    assert.deepEqual([job.body['Контрагент'], job.body['Контрагент_Type'], job.body['Контрагент_Key']], [cp!['Ref_Key'], 'StandardODATA.Catalog_Контрагенты', undefined]);
    const created = await client.create(md, job.entitySet, job.body);
    assert.ok(created.ok);
    const hit = await client.page(job.entitySet, { filter: `Контрагент eq ${castRef(String(cp!['Ref_Key']), 'Catalog_Контрагенты')}`, select: ['Ref_Key'] });
    assert.ok(hit.ok);
    assert.deepEqual(hit.rows.map((r) => r['Ref_Key']), [created.ok ? created.ref : null]);
    const otherType = await client.page(job.entitySet, { filter: `Контрагент eq ${castRef(String(cp!['Ref_Key']), 'Catalog_ФизическиеЛица')}` });
    assert.ok(otherType.ok);
    assert.equal(otherType.rows.length, 0, 'the same guid of another catalogue is another object');
    assert.equal(castRef('a-b', 'Catalog_X'), "cast(guid'a-b', 'Catalog_X')");
    // A plain reference (the receipt's Контрагент_Key) is written as such.
    const receipt: DocumentJob = { entitySet: 'Document_ПоступлениеТоваровУслуг', body: {}, needs: [], notes: [] };
    assert.ok(writeRef(md, receipt, 'Товары', { ...need, ref: DEFAULT_OBJECT_MAP.invoice.refs!['counterparty']! }, 'k-1'));
    assert.deepEqual(receipt.body, { Контрагент_Key: 'k-1' });
  });

  it('dates are datetime\'…\' without a zone, LineNumber is a string, numbers are numbers (onec §8.33)', () => {
    // onec §8.33: a receipt dated at local midnight; a zone suffix would shift it by the server's offset.
    assert.equal(datetime('2026-10-03'), "datetime'2026-10-03T00:00:00'");
    assert.equal(bodyDate('2026-10-03'), '2026-10-03T00:00:00');
    const job = invoiceDocument(DEFAULT_OBJECT_MAP, INVOICE_META, INVOICE_LINES);
    assert.equal(job.body['Date'], '2026-10-03T00:00:00');
    assert.equal(job.body['ДатаВходящегоДокумента'], '2026-10-03T00:00:00');
    assert.ok(!/Z|[+-]\d\d:\d\d$/.test(String(job.body['Date'])));
    const row = (job.body['Товары'] as Record<string, unknown>[])[0]!;
    assert.equal(row['LineNumber'], '1');
    assert.equal(typeof row['Количество'], 'number');
    assert.equal(typeof row['Сумма'], 'number');
  });

  it('a write is never re-sent after a redirect, and plain http is flagged (onec §8.26)', async () => {
    // onec §8.26: an http→https redirect turns a POST into a GET (403/405); Basic auth over http travels in clear text.
    fake.redirectWrites = 'https://onec.example.uz/base/odata/standard.odata/Catalog_Номенклатура';
    const before = fake.seen.length;
    const r = await client.create(md, 'Catalog_Номенклатура', { Description: 'x' });
    fake.redirectWrites = null;
    assert.ok(!r.ok);
    assert.equal(r.status, 301);
    assert.equal(r.reason, 'redirected');
    assert.equal(r.location, 'https://onec.example.uz/base/odata/standard.odata/Catalog_Номенклатура');
    assert.equal(fake.seen.length, before + 1, 'not followed');
    assert.equal(client.insecure, true);
    assert.equal(new ODataClient({ baseUrl: 'https://onec.example.uz/base', username: null, password: null }).insecure, false);
  });
});

describe('1C\'s own responses and error envelopes, as saved', () => {
  it('the XML envelope (code 9) and the JSON one are read; every internal code 0–20 has a word (onec §5.5)', () => {
    // onec §5.5: 4XX bodies carry m:error/m:code + m:message (XML) or odata.error (JSON).
    assert.deepEqual(parseODataError(sample('error-code-9.xml')), { code: 9, message: 'Экземпляр сущности "НакладнаяОтгрузки" не найден по переданному ключу.' });
    assert.deepEqual(parseODataError('{"odata.error":{"code":"13","message":{"lang":"ru","value":"Создание строк табличных частей напрямую не поддерживается"}}}'),
      { code: 13, message: 'Создание строк табличных частей напрямую не поддерживается' });
    assert.deepEqual(parseODataError('{"odata.error":{"code":"","message":{"lang":"ru","value":"Не заполнено поле"}}}'), { code: null, message: 'Не заполнено поле' });
    const codes = sampleJson<Record<string, string>>('error-codes.json');
    assert.deepEqual(Object.keys(codes).map(Number), Object.keys(ODATA_ERROR_CODES).map(Number));
    assert.equal(reasonOf(400, 13), 'onec_rows_direct');
    assert.equal(reasonOf(404, 9), 'onec_not_found');
    assert.equal(reasonOf(400, 19), 'onec_method_forbidden');
  });

  it('real list answers: odata.metadata, $select, $expand and the string odata.count read as 1C writes them (onec §5.3)', async () => {
    // onec §5.3: 1C:Fresh guide samples served verbatim (names of persons replaced, SOURCES.md).
    const answers: Record<string, string> = {
      Catalog_ФизическиеЛица: sample('list-fizlica-inlinecount.json'),
      Catalog_Номенклатура: sample('list-nomenklatura-filter-select.json'),
      Catalog_Сотрудники: sample('list-sotrudniki-expand.json'),
    };
    const asked: string[] = [];
    const stub = ((input: string | URL | Request) => {
      const url = decodeURIComponent(input instanceof Request ? input.url : input.toString());
      asked.push(url);
      const set = /standard\.odata\/([^?]+)/.exec(url)?.[1] ?? '';
      return Promise.resolve(new Response(answers[set] ?? '{}', { status: 200, headers: { 'content-type': 'application/json' } }));
    }) as typeof fetch;
    const c = new ODataClient({ baseUrl: 'https://1cfresh.com/a/sbm_demo/1962515', username: 'u', password: 'p' }, stub);
    const persons = await c.page('Catalog_ФизическиеЛица', { select: ['Description', 'ДатаРождения'], filter: "Пол eq 'Мужской'", top: 3, count: true });
    assert.ok(persons.ok);
    assert.equal(persons.count, 28);
    assert.equal(persons.rows.length, 3);
    assert.match(asked[0] ?? '', /\$select=Description,ДатаРождения&\$top=3&\$inlinecount=allpages/);
    const goods = await c.page('Catalog_Номенклатура', { select: ['НаименованиеПолное', 'Артикул'] });
    assert.ok(goods.ok);
    assert.deepEqual(goods.rows.map((r) => r['Артикул']), ['8940', '8941', '8942']);
    assert.equal(goods.count, null, 'no $inlinecount asked, none read');
    const staff = await c.page('Catalog_Сотрудники', {});
    assert.ok(staff.ok);
    assert.equal((staff.rows[0]?.['Физлицо'] as Record<string, unknown>)['Code'], 'ФР-0000002');
    const created = sampleJson('post-201-fizlico.json');
    assert.ok(typeof created['Ref_Key'] === 'string' && typeof created['DataVersion'] === 'string', 'a 201 body carries the new key and version');
    assert.ok(!hasRefKey(withoutKeys(created)));
  });

  it('the receipt: count 6 dp, sums 2 dp, the total from the document, marks per line, a high-risk ЭСФ on 4410.11 (onec §8.36–38)', () => {
    // onec §8.37: Count ≤ 6 decimals, money 2; the header total is the ЭСФ's own, not re-added from the lines.
    const lines = [
      { ...INVOICE_LINES[0]!, quantity: '10.123456', price: '45000.004', amount: '454555.56', vatAmount: '54546.667', total: '509102.23', markingCodes: ['010478000000001721ABC', '010478000000001721ABD'] },
      { ...INVOICE_LINES[3]!, vatRate: null, vatAmount: null },
    ];
    const meta = { ...INVOICE_META, totalWithVat: '2184000.00', riskLevel: 'high' as const };
    const job = invoiceDocument(DEFAULT_OBJECT_MAP, meta, lines);
    const rows = job.body['Товары'] as Record<string, unknown>[];
    assert.equal(rows[0]?.['Количество'], 10.123456, 'six decimals kept');
    assert.equal(rows[0]?.['Цена'], 45000);
    assert.equal(rows[0]?.['СуммаНДС'], 54546.67);
    assert.equal(rows[0]?.['СтавкаНДС'], 'НДС12');
    assert.equal(rows[1]?.['СтавкаНДС'], 'БезНДС');
    assert.equal(job.body['СуммаДокумента'], 2184000, 'the document\'s own total');
    // onec §8.38: marks preserved line by line.
    assert.deepEqual(job.body['КодыМаркировки'], [
      { LineNumber: '1', НомерСтрокиТовары: '1', КодМаркировки: '010478000000001721ABC' },
      { LineNumber: '2', НомерСтрокиТовары: '1', КодМаркировки: '010478000000001721ABD' },
    ]);
    // onec §8.36: the risk flag passes through: the VAT account of every line is looked up as 4410.11, and the comment says why.
    assert.deepEqual(job.needs.filter((n) => n.name === 'vatAccount').map((n) => [n.value, n.line]), [['4410.11', 0], ['4410.11', 1]]);
    assert.match(String(job.body['Комментарий']), /высокий уровень риска/);
    const normal = invoiceDocument(DEFAULT_OBJECT_MAP, INVOICE_META, lines);
    assert.equal(normal.needs.filter((n) => n.name === 'vatAccount').length, 0);
    const partial = invoiceDocument(DEFAULT_OBJECT_MAP, INVOICE_META, [INVOICE_LINES[0]!], false);
    assert.equal(partial.body['СуммаДокумента'], 504000, 'a partial receipt totals its own lines');
    assert.ok(partial.notes.includes('partial_document'));
  });
});

// ── The transfer end to end (database) ─────────────────────────────────────────────────────

async function skipReason(): Promise<string | false> {
  try {
    await db.$queryRaw`SELECT 1 FROM onec_connection LIMIT 1`;
    return false;
  } catch {
    return 'database not reachable';
  }
}
const skip = await skipReason();

describe('OData transfer against the fake 1C (database)', { skip }, () => {
  const orgs: string[] = [];
  // Each test its own base: the same ИНН seeded twice would be ambiguous, as in a real 1C.
  let fake: FakeOData | undefined;
  const connect = async (org: TestActor, base: string, objectMap = DEFAULT_OBJECT_MAP) => {
    const saved = await saveConnection(org.orgId, org.userId, { kind: 'odata', baseUrl: base, username: 'odata', password: 's3cret', objectMap });
    assert.ok(saved.ok);
  };
  const products = (f: FakeOData) => f.seed('Catalog_Номенклатура', INVOICE_LINES.map((l) => ({ Description: l.name, IsFolder: false })));

  after(async () => {
    await fake?.close();
    await dropOrgs(orgs);
  });

  it('B4: a payment carries ВидОперации, the counterparty, its contract, the ДДС item and our account found in the base; Post() when the map asks', async () => {
    const f = await startFakeOData();
    fake = f;
    const org = await makeOrg();
    orgs.push(org.orgId);
    const [cp] = f.seed('Catalog_Контрагенты', [{ Description: 'ООО "Ромашка Савдо"', ИНН: '301234567', IsFolder: false }]);
    const [contract] = f.seed('Catalog_ДоговорыКонтрагентов', [{ Description: '4/28', Owner_Key: cp!['Ref_Key'], IsFolder: false }]);
    f.seed('Catalog_ДоговорыКонтрагентов', [{ Description: '4/28', Owner_Key: 'someone-else', IsFolder: false }]);
    const [item] = f.seed('Catalog_СтатьиДвиженияДенежныхСредств', [{ Description: 'Оплата от покупателей', IsFolder: false }]);
    const [account] = f.seed('Catalog_БанковскиеСчета', [{ НомерСчета: OUR_ACCOUNT, IsFolder: false }]);
    const map = structuredClone(DEFAULT_OBJECT_MAP);
    map.bankCredit.post = true;
    await connect(org, f.base, map);
    const t = { ...BANK_TRANSACTIONS[0]!, docNumber: 'b4-1', operation: 'payment_in', contract: '4/28', cashFlowItem: 'Оплата от покупателей' };
    const batchId = await seedBankBatch({ orgId: org.orgId }, { transactions: [t] });
    const before = f.writes().length;
    const sent = await transferExport({ orgId: org.orgId, batchId, format: 'odata', actorId: org.userId });
    assert.ok(sent.ok, JSON.stringify(sent));
    assert.equal(sent.outcome.imported, 1);
    const writes = f.writes().slice(before);
    assert.deepEqual(writes.map((w) => w.path.replace(/\(guid'.*/, '(…)')), ['Document_ПоступлениеНаРасчетныйСчет', 'Document_ПоступлениеНаРасчетныйСчет(…)']);
    const body = writes[0]!.body!;
    assert.equal(body['ВидОперации'], 'ОплатаПокупателя');
    assert.equal(body['Контрагент'], cp!['Ref_Key']);
    assert.equal(body['Контрагент_Type'], 'StandardODATA.Catalog_Контрагенты');
    assert.equal(body['ДоговорКонтрагента_Key'], contract!['Ref_Key'], 'the contract of that counterparty, not the other one with the same number');
    assert.equal(body['СтатьяДвиженияДенежныхСредств_Key'], item!['Ref_Key']);
    assert.equal(body['СчетОрганизации_Key'], account!['Ref_Key']);
    assert.ok(!hasRefKey(body));
    const doc = f.store.get('Document_ПоступлениеНаРасчетныйСчет')!.find((o) => o['НомерВходящегоДокумента'] === 'b4-1')!;
    assert.equal(doc['Posted'], true);
    const rec = await db.importRecord.findFirstOrThrow({ where: { batchId } });
    assert.equal(rec.status, 'exported');
    assert.equal((rec.outcome as { onecRef: string }).onecRef, doc['Ref_Key']);

    // A refused posting leaves the document written (unposted) and says why on the record.
    f.postRefusal = 'Не заполнено поле "Счет учета"';
    const second = await seedBankBatch({ orgId: org.orgId }, { transactions: [{ ...t, docNumber: 'b4-2' }] });
    const refusedPost = await transferExport({ orgId: org.orgId, batchId: second, format: 'odata', actorId: org.userId });
    f.postRefusal = null;
    assert.ok(refusedPost.ok);
    const rec2 = await db.importRecord.findFirstOrThrow({ where: { batchId: second } });
    assert.equal(rec2.status, 'exported', 'the document exists in 1C: sending it again would duplicate it');
    assert.match((rec2.outcome as { message: string }).message, /post_refused: Не заполнено поле "Счет учета"/);
  });

  it('a corrected ЭСФ updates the receipt of the one it corrects instead of creating a second (onec §8.35)', async () => {
    // onec §8.35: FacturaType ≠ 0 with OldFacturaDoc; found first in Tasnivo's own transfers, else in the base by number, date and counterparty.
    await fake?.close();
    const f = await startFakeOData();
    fake = f;
    const org = await makeOrg();
    orgs.push(org.orgId);
    const [cp] = f.seed('Catalog_Контрагенты', [{ Description: 'ООО "Ромашка Савдо"', ИНН: '301234567', IsFolder: false }]);
    products(f);
    await connect(org, f.base);
    const receipts = () => f.store.get('Document_ПоступлениеТоваровУслуг') ?? [];
    const firstBatch = await seedInvoiceBatch({ orgId: org.orgId }, { ...INVOICE_META, externalId: 'esf-c-1', number: 'ЭСФ-500' });
    const first = await transferExport({ orgId: org.orgId, batchId: firstBatch, format: 'odata', actorId: org.userId });
    assert.ok(first.ok, JSON.stringify(first));
    const count = receipts().length;
    const original = receipts().find((o) => o['НомерВходящегоДокумента'] === 'ЭСФ-500')!;

    const corrected = { ...INVOICE_META, externalId: 'esf-c-2', number: 'ЭСФ-500/1', facturaType: 4, oldFactura: { id: 'esf-c-1', number: 'ЭСФ-500', date: INVOICE_META.date } };
    const fixedBatch = await seedInvoiceBatch({ orgId: org.orgId }, corrected);
    await db.importRecord.updateMany({ where: { batchId: fixedBatch, rowIndex: 0 }, data: { payload: { ...INVOICE_LINES[0]!, quantity: '12', amount: '540000', vatAmount: '64800.00', total: '604800.00' } } });
    const before = f.seen.length;
    const second = await transferExport({ orgId: org.orgId, batchId: fixedBatch, format: 'odata', actorId: org.userId });
    assert.ok(second.ok, JSON.stringify(second));
    assert.equal(receipts().length, count, 'no second receipt');
    const calls = f.seen.slice(before).filter((s) => s.method !== 'GET');
    assert.deepEqual(calls.map((c) => `${c.method} ${c.path}`), [`PATCH Document_ПоступлениеТоваровУслуг(guid'${String(original['Ref_Key'])}')`]);
    assert.ok(typeof calls[0]?.headers['if-match'] === 'string');
    assert.equal((original['Товары'] as { Количество: number }[])[0]?.Количество, 12);
    assert.equal((original['Товары'] as unknown[]).length, 4, 'the whole part was resent');
    const rec = await db.importRecord.findFirstOrThrow({ where: { batchId: fixedBatch, rowIndex: 0 } });
    assert.match((rec.outcome as { message: string }).message, /correction_updated/);

    // The original was loaded into 1C some other way: it is found in the base by number, date and counterparty.
    const [old] = f.seed('Document_ПоступлениеТоваровУслуг', [{ НомерВходящегоДокумента: 'ЭСФ-777', ДатаВходящегоДокумента: '2026-09-01T00:00:00', Контрагент_Key: cp!['Ref_Key'], Товары: [] }]);
    const third = await seedInvoiceBatch({ orgId: org.orgId }, { ...INVOICE_META, externalId: 'esf-c-3', number: 'ЭСФ-777/1', facturaType: 4, oldFactura: { id: null, number: 'ЭСФ-777', date: '2026-09-01' } });
    const n = receipts().length;
    const viaBase = await transferExport({ orgId: org.orgId, batchId: third, format: 'odata', actorId: org.userId });
    assert.ok(viaBase.ok);
    assert.equal(receipts().length, n);
    assert.equal((old!['Товары'] as unknown[]).length, 4);
    const lookup = f.seen.find((s) => s.method === 'GET' && (s.query.get('$filter') ?? '').includes("НомерВходящегоДокумента eq 'ЭСФ-777'"));
    assert.match(lookup?.query.get('$filter') ?? '', /ДатаВходящегоДокумента eq datetime'2026-09-01T00:00:00'/);
    assert.match(lookup?.query.get('$filter') ?? '', new RegExp(`Контрагент_Key eq guid'${String(cp!['Ref_Key'])}'`));
  });

  // Review 30 Oct: invoice numbers repeat across sellers (both №15 of the same day); the additional types 1/6/9 add to
  // the original rather than replace it (didox research §2.1 "SubTypes"); and a PATCH replaces the whole tabular part.
  it('a correction replaces only its own seller\'s receipt, an additional ЭСФ is a receipt of its own, a correction in parts is refused', async () => {
    await fake?.close();
    const f = await startFakeOData();
    fake = f;
    const org = await makeOrg();
    orgs.push(org.orgId);
    const [romashka] = f.seed('Catalog_Контрагенты', [{ Description: 'ООО "Ромашка Савдо"', ИНН: '301234567', IsFolder: false }]);
    f.seed('Catalog_Контрагенты', [{ Description: 'ООО "Другой Поставщик"', ИНН: '309999999', IsFolder: false }]);
    products(f);
    await connect(org, f.base);
    const receipts = () => f.store.get('Document_ПоступлениеТоваровУслуг') ?? [];
    const firstBatch = await seedInvoiceBatch({ orgId: org.orgId }, { ...INVOICE_META, externalId: 'r-a-15', number: '15' });
    assert.ok((await transferExport({ orgId: org.orgId, batchId: firstBatch, format: 'odata', actorId: org.userId })).ok);
    const original = receipts().find((o) => o['НомерВходящегоДокумента'] === '15')!;
    const linesOf = (o: Record<string, unknown>) => (o['Товары'] as { Количество: number }[]).map((r) => r.Количество);
    const kept = linesOf(original);

    // Another seller's corrected №15 of the same day, its original never sent to 1C: a receipt of its own, A's untouched.
    const other = { ...INVOICE_META.seller, name: 'ООО "Другой Поставщик"', inn: '309999999' };
    const b = await seedInvoiceBatch({ orgId: org.orgId }, {
      ...INVOICE_META, externalId: 'r-b-15', number: '15', seller: other, facturaType: 4, oldFactura: { id: 'roaming-of-b', number: '15', date: INVOICE_META.date },
    });
    await db.importRecord.updateMany({ where: { batchId: b, rowIndex: 0 }, data: { payload: { ...INVOICE_LINES[0]!, quantity: '99' } } });
    let n = receipts().length;
    assert.ok((await transferExport({ orgId: org.orgId, batchId: b, format: 'odata', actorId: org.userId })).ok);
    assert.equal(receipts().length, n + 1, 'B\'s correction is a receipt of its own');
    assert.equal(original['Контрагент_Key'] ?? original['Контрагент'], romashka!['Ref_Key'], 'A\'s receipt keeps its supplier');
    assert.deepEqual(linesOf(original), kept, 'and its lines');

    // A's additional ЭСФ (type 1) to №15: its own receipt; the original keeps its four lines.
    const extra = await seedInvoiceBatch({ orgId: org.orgId }, {
      ...INVOICE_META, externalId: 'r-a-15-extra', number: '15-D', facturaType: 1, oldFactura: { id: 'r-a-15', number: '15', date: INVOICE_META.date },
    });
    n = receipts().length;
    assert.ok((await transferExport({ orgId: org.orgId, batchId: extra, format: 'odata', actorId: org.userId })).ok);
    assert.equal(receipts().length, n + 1);
    assert.deepEqual(linesOf(original), kept);

    // A's correction (type 4) with three of its four lines: refused, nothing written; the whole of it replaces the receipt.
    const fix = await seedInvoiceBatch({ orgId: org.orgId }, {
      ...INVOICE_META, externalId: 'r-a-15-fix', number: '15/1', facturaType: 4, oldFactura: { id: 'r-a-15', number: '15', date: INVOICE_META.date },
    });
    const ids = (await db.importRecord.findMany({ where: { batchId: fix }, orderBy: { rowIndex: 'asc' }, select: { id: true } })).map((r) => r.id);
    const writes = f.writes().length;
    const part = await transferExport({ orgId: org.orgId, batchId: fix, format: 'odata', actorId: org.userId, recordIds: ids.slice(0, 3) });
    assert.ok(part.ok, JSON.stringify(part));
    assert.equal(part.outcome.reasons['correction_partial'], 3);
    assert.equal(f.writes().length, writes, 'nothing written');
    assert.deepEqual(linesOf(original), kept);
    n = receipts().length;
    const whole = await transferExport({ orgId: org.orgId, batchId: fix, format: 'odata', actorId: org.userId });
    assert.ok(whole.ok && whole.outcome.imported === 4, JSON.stringify(whole));
    assert.equal(receipts().length, n, 'the whole correction updates the receipt');
    assert.equal((original['Товары'] as unknown[]).length, 4);
  });

  // Review 30 Oct: a receipt POST that 1C processed but whose answer timed out was written again on "Retry"; only bank
  // lines looked first. The receipt is looked up by its number, date and counterparty before a second POST.
  it('a receipt whose POST timed out is found in the base on retry, not written twice', async () => {
    await fake?.close();
    const f = await startFakeOData();
    fake = f;
    const org = await makeOrg();
    orgs.push(org.orgId);
    f.seed('Catalog_Контрагенты', [{ Description: 'ООО "Ромашка Савдо"', ИНН: '301234567', IsFolder: false }]);
    products(f);
    await connect(org, f.base);
    const receipts = () => (f.store.get('Document_ПоступлениеТоваровУслуг') ?? []).filter((o) => o['НомерВходящегоДокумента'] === 'T-30');
    const batchId = await seedInvoiceBatch({ orgId: org.orgId }, { ...INVOICE_META, externalId: 'r-t-30', number: 'T-30' });
    let lose = true;
    const lossy: typeof fetch = async (input, init) => {
      const res = await fetch(input, init);
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (lose && init?.method === 'POST' && !url.includes('Post()')) {
        lose = false;
        const e = new Error('The operation was aborted due to timeout');
        e.name = 'TimeoutError';
        throw e;
      }
      return res;
    };
    const first = await transferExport({ orgId: org.orgId, batchId, format: 'odata', actorId: org.userId }, lossy);
    assert.ok(first.ok && first.outcome.rejected === 4, JSON.stringify(first));
    assert.equal(receipts().length, 1, '1C wrote it; the answer was lost');
    const again = await transferExport({ orgId: org.orgId, batchId, format: 'odata', actorId: org.userId });
    assert.ok(again.ok && again.outcome.imported === 4, JSON.stringify(again));
    assert.equal(receipts().length, 1, 'found, not written twice');
    const rec = await db.importRecord.findFirstOrThrow({ where: { batchId, rowIndex: 0 } });
    assert.match((rec.outcome as { message: string }).message, /found_after_timeout/);
  });

  it('a goods line whose product the base lacks refuses the receipt and names the line (onec §8.11)', async () => {
    // onec §8.11: with «Не создавать номенклатуру» 1C would not invent the item; the tool reports the unmatched lines.
    const lonely = await startFakeOData();
    try {
      lonely.seed('Catalog_Номенклатура', INVOICE_LINES.slice(0, 3).map((l) => ({ Description: l.name, IsFolder: false })));
      const org = await makeOrg();
      orgs.push(org.orgId);
      await connect(org, lonely.base);
      const batchId = await seedInvoiceBatch({ orgId: org.orgId }, { ...INVOICE_META, externalId: 'esf-n-1', number: 'ЭСФ-900' });
      const r = await transferExport({ orgId: org.orgId, batchId, format: 'odata', actorId: org.userId });
      assert.ok(r.ok);
      assert.equal(r.outcome.rejected, 4);
      assert.equal(r.outcome.reasons['nomenclature_missing'], 4);
      assert.equal(lonely.writes().length, 0, 'nothing written');
      const rec = await db.importRecord.findFirstOrThrow({ where: { batchId, rowIndex: 0 } });
      assert.equal((rec.outcome as { message: string }).message, 'lines 4');
    } finally {
      await lonely.close();
    }
  });

  it('a base without the receipt in its composition refuses the transfer with the gap named, before writing (onec §8.25)', async () => {
    // onec §8.25: actionable error text instead of 1C silently ignoring unknown properties.
    const bare = await startFakeOData({ spec: without(BP_UZ_SPEC, (s) => { delete s['Document_ПоступлениеТоваровУслуг']; }) });
    try {
      const org = await makeOrg();
      orgs.push(org.orgId);
      await connect(org, bare.base);
      const batchId = await seedInvoiceBatch({ orgId: org.orgId }, { ...INVOICE_META, externalId: 'esf-g-1', number: 'ЭСФ-901' });
      const r = await transferExport({ orgId: org.orgId, batchId, format: 'odata', actorId: org.userId });
      assert.deepEqual(r, { ok: false, error: 'composition_incomplete', problems: [{ kind: 'set_missing', target: 'invoice', entitySet: 'Document_ПоступлениеТоваровУслуг', required: true }] });
      assert.equal(bare.writes().length, 0);
      assert.equal(await db.oneCExport.count({ where: { batchId } }), 0);
    } finally {
      await bare.close();
    }
  });
});
