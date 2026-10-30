// Counterparty requisites and the 1C «Контрагенты» reader (research note onec §1.4, §6, checklist
// §8.13–17). The xlsx fixtures are built here with exceljs in the shapes the sources describe:
// «Ещё → Вывести список» writes the list's own column captions, any subset the accountant ticked,
// with whatever stands above the header; Excel turns an МФО typed as a number into 444.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import ExcelJS from 'exceljs';
import { db } from '@tasnivo/db';
import { makeClient } from '../firm-test-fixtures.js';
import { dropOrgs, makeOrg } from '../test-fixtures.js';
import { counterpartyColumns, decide, findHeaderRow, importCounterparties, kindFromCell } from './counterparties.js';
import { checkRequisites, kindOf, mfoOf, validAccount, validInn, validPinfl, validVatCode } from './requisites.js';

/** A sheet as «Вывести список» → «Сохранить как» xlsx leaves it: rows as given, numbers as number cells. */
async function sheet(rows: (string | number | null)[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Лист1');
  for (const r of rows) ws.addRow(r);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe('counterparty requisites (onec §8.13)', () => {
  it('ИНН 9, ПИНФЛ 14, VAT code 12, account 20 (27 for a budget ЛС), МФО 5 with its zeros put back', () => {
    // onec §8.13: `310529901`, `326080220838`, `20208000905656222001`, МФО `00401` (Didox example, 1C UZ 3.0.42/3.0.46).
    assert.ok(validInn('310529901') && !validInn('31052990') && !validInn('3105299011'));
    assert.ok(validPinfl('31507976020031') && !validPinfl('3150797602003'));
    assert.ok(validVatCode('326080220838') && !validVatCode('32608022083'));
    assert.ok(validAccount('20208000905656222001') && !validAccount('2020800090565622200'));
    assert.ok(!validAccount('400910860262777094100079001') && validAccount('400910860262777094100079001', true), '27 digits only for «Бюджетный ЛС»');
    // B8: Excel strips an МФО's leading zeros; 1–5 digits are padded back, longer is not an МФО.
    assert.deepEqual(['401', '83', '00444', '444', '00974', '123456', ''].map(mfoOf), ['00401', '00083', '00444', '00444', '00974', null, null]);
    assert.deepEqual(checkRequisites({ inn: '310529901', vatCode: '3260802208', account: '2.0208E+19', mfo: '401' }), {
      value: { inn: '310529901', kind: 'legal', vatCode: null, account: null, mfo: '00401', branchCode: null },
      fatal: null, warnings: ['vat_code_invalid', 'account_invalid'],
    });
  });

  it('an individual by ПИНФЛ without ИНН; no identifier only for a non-resident (onec §8.15, §8.16)', () => {
    // onec §8.15: «Вид контрагента» = «Физ.лицо» exposes ПИНФЛ instead of ИНН (3.0.24).
    assert.deepEqual(checkRequisites({ pinfl: '31507976020031', kind: kindOf('Физ. лицо') }).value.kind, 'individual');
    assert.equal(checkRequisites({ pinfl: '31507976020031' }).value.inn, '31507976020031');
    assert.equal(checkRequisites({ inn: '31507976020031' }).value.kind, 'individual', 'a 14-digit value in the ИНН/ПИНФЛ column');
    assert.equal(checkRequisites({ pinfl: '315079760200' }).fatal, 'pinfl_invalid');
    // onec §8.16: empty ИНН is allowed only for the non-resident type.
    assert.equal(checkRequisites({ kind: kindOf('Юридическое лицо (нерезидент)') }).fatal, null);
    assert.equal(checkRequisites({ kind: kindOf('Юридическое лицо') }).fatal, 'inn_required');
    assert.equal(checkRequisites({ kind: kindOf('Физическое лицо') }).fatal, 'inn_required');
    assert.equal(checkRequisites({}).fatal, null, 'a list that does not say the kind is not refused');
    assert.deepEqual(['Юр. лицо', 'Yuridik shaxs', 'ИП', 'Jismoniy shaxs', 'Иностранная организация', ''].map(kindOf), ['legal', 'legal', 'individual', 'individual', 'nonresident', null]);
  });

  it('two branches of one ИНН are two counterparties: ИНН + код филиала decides (onec §8.14)', () => {
    // onec §8.14: 1C UZ 3.0.62 refuses a duplicate only when ИНН and код филиала both match.
    const row = (id: string, branchCode: string | null) => ({
      id, name: 'АО «Узпромстройбанк»', normalizedName: 'узпромстройбанк', inn: '200833707', account: null, mfo: null, aliases: [], clientId: null,
      kind: 'legal', branchCode, vatCode: null, onecRef: null,
    });
    const rows = [row('a', '00001'), row('b', '00002')];
    const ref = (branchCode: string | null) => ({ name: 'АО «Узпромстройбанк»', inn: '200833707', account: null, mfo: null, counterpartyId: null, branchCode });
    assert.equal(decide(ref('00002'), rows).chosen?.id, 'b');
    assert.equal(decide(ref('00003'), rows).status, 'new', 'another branch, not the same name of a known one');
    assert.equal(decide(ref(null), rows).status, 'ambiguous', 'without the branch code the ИНН alone cannot choose');
  });

  it('a branch of an ИНН known only without its branch is that row; «Резидентство: Да» is a resident (review 30 Oct)', () => {
    // R-O9: an import row with ИНН + код филиала created a second counterparty next to the one a statement had made,
    // and every later statement's ИНН became ambiguous; a «Да» under «Резидентство» was read as non-resident.
    const row = (id: string, branchCode: string | null) => ({
      id, name: 'АО «Узпромстройбанк»', normalizedName: 'узпромстройбанк', inn: '200833707', account: null, mfo: null, aliases: [], clientId: null,
      kind: 'legal', branchCode, vatCode: null, onecRef: null,
    });
    const ref = { name: 'АО «Узпромстройбанк»', inn: '200833707', account: null, mfo: null, counterpartyId: null, branchCode: '00001' };
    assert.equal(decide(ref, [row('s', null)]).chosen?.id, 's', 'the only row of that ИНН, its branch not known');
    assert.equal(decide(ref, [row('s', null), row('b', '00002')]).status, 'new', 'branches are known for that ИНН: another one is new');
    assert.deepEqual(['Да', 'Нет', 'да'].map((v) => kindFromCell(v, 'Резидентство')), [null, 'nonresident', null]);
    assert.deepEqual(['Да', 'Нет'].map((v) => kindFromCell(v, 'Нерезидент')), ['nonresident', null]);
    assert.equal(kindFromCell('Юридическое лицо', 'Вид контрагента'), 'legal');
  });
});

describe('the «Вывести список» reader: any subset of captions, the header on any top row (onec §8.17)', () => {
  it('finds the columns by the 1C captions, ru and uz, and the header under title rows', () => {
    // onec §8.17: Наименование, ИНН, Полное наименование, Код, possibly ПИНФЛ and Регистрационный код плательщика НДС.
    assert.deepEqual(counterpartyColumns(['Наименование', 'ИНН', 'Полное наименование', 'Код']), {
      vatCode: -1, branch: -1, kind: -1, fullName: 2, pinfl: -1, inn: 1, account: -1, mfo: -1, bank: -1, code: 3, name: 0,
    });
    const wide = counterpartyColumns(['Код', 'Наименование', 'ИНН', 'ПИНФЛ', 'Регистрационный код плательщика НДС', 'Код филиала', 'Вид контрагента', 'Наименование банка', 'Код банка']);
    assert.deepEqual([wide.code, wide.name, wide.inn, wide.pinfl, wide.vatCode, wide.branch, wide.kind, wide.bank, wide.mfo], [0, 1, 2, 3, 4, 5, 6, 7, 8]);
    const uz = counterpartyColumns(['Nomi', 'STIR', 'Hisob raqami', 'MFO']);
    assert.deepEqual([uz.name, uz.inn, uz.account, uz.mfo], [0, 1, 2, 3]);
    assert.equal(counterpartyColumns(['Полное наименование', 'ИНН']).name, 0, 'only the full name: it names them');
    assert.equal(findHeaderRow([['Контрагенты'], ['Отбор: Группа = Поставщики'], undefined, ['Наименование', 'ИНН'], ['ООО "Альфа"', '301111111']]), 3);
    assert.equal(findHeaderRow([['a', 'b'], ['1', '2']]), -1);
  });
});

describe('the 1C «Контрагенты» import (database)', { skip: await db.$queryRaw`SELECT "branchCode" FROM counterparty LIMIT 1`.then(() => false, () => 'database not reachable or migration 20261109000400 not applied') }, () => {
  const orgs: string[] = [];
  let orgId = '';
  let client = '';
  before(async () => {
    const org = await makeOrg();
    orgs.push(org.orgId);
    orgId = org.orgId;
    await db.organization.update({ where: { id: orgId }, data: { trialEndsAt: new Date(Date.now() + 7 * 86_400_000) } });
    client = await makeClient(orgId, 'Mijoz kontragentlar');
  });
  after(() => dropOrgs(orgs));

  it('a list with title rows, branches, an individual, a non-resident, and the rows it cannot take named (onec §8.14–17)', async () => {
    const file = await sheet([
      ['Контрагенты'],
      ['Отбор: Пометка удаления = Нет'],
      [],
      ['Код', 'Наименование', 'ИНН', 'ПИНФЛ', 'Регистрационный код плательщика НДС', 'Код филиала', 'Вид контрагента'],
      ['00-000001', 'ООО "Ромашка Савдо"', '301234567', null, '326080220838', null, 'Юридическое лицо'],
      ['00-000002', 'АО «Узпромстройбанк»', '200833707', null, null, '00001', 'Юридическое лицо'],
      ['00-000003', 'АО «Узпромстройбанк»', '200833707', null, null, '00002', 'Юридическое лицо'],
      ['00-000004', 'Иванов Иван ИП', null, '31507976020031', null, null, 'Физическое лицо'],
      ['00-000005', 'Siemens AG', null, null, null, null, 'Юридическое лицо (нерезидент)'],
      ['00-000006', 'ООО Без ИНН', null, null, null, null, 'Юридическое лицо'],
      ['00-000007', 'ООО Длинный ИНН', '3012345678', null, null, null, 'Юридическое лицо'],
      ['00-000008', 'ООО Кривой код НДС', '305555555', null, '32608022083', null, 'Юридическое лицо'],
    ]);
    const first = await importCounterparties(orgId, client, file, 'kontragenty.xlsx');
    assert.deepEqual(first, {
      ok: true, rows: 8, created: 6, updated: 0, skipped: 2,
      errors: [{ row: 6, reason: 'inn_required' }, { row: 7, reason: 'inn_invalid' }, { row: 8, reason: 'vat_code_invalid' }],
    });
    const rows = await db.counterparty.findMany({ where: { orgId, clientId: client }, orderBy: { onecRef: 'asc' } });
    assert.deepEqual(rows.map((r) => [r.onecRef, r.inn, r.kind, r.branchCode, r.vatCode]), [
      ['00-000001', '301234567', 'legal', null, '326080220838'],
      ['00-000002', '200833707', 'legal', '00001', null],
      ['00-000003', '200833707', 'legal', '00002', null],
      ['00-000004', '31507976020031', 'individual', null, null],
      ['00-000005', null, 'nonresident', null, null],
      ['00-000008', '305555555', 'legal', null, null],
    ]);
    const again = await importCounterparties(orgId, client, file, 'kontragenty.xlsx');
    assert.ok(again.ok);
    assert.equal(again.created, 0, 'loaded again: no duplicates, the branches included');
  });

  it('an МФО Excel stored as a number gets its leading zeros back; uz captions; a narrow list of four BP columns (onec §8.13, B8)', async () => {
    // B8 (counterparties.ts:262 before): «00444» saved by Excel as 444 was dropped as "not 5 digits".
    const file = await sheet([
      ['Nomi', 'STIR', 'Hisob raqami', 'MFO'],
      ['MChJ «Qurilish Gʻisht»', '302345678', '20208000200300400502', 873],
      ['Toshkent shahar soliq boshqarmasi', '200935935', '23402000300100001010', 14],
    ]);
    const r = await importCounterparties(orgId, null, file, 'kontragentlar.xlsx');
    assert.deepEqual(r, { ok: true, rows: 2, created: 2, updated: 0, skipped: 0, errors: [] });
    const stored = await db.counterparty.findMany({ where: { orgId, clientId: null }, orderBy: { inn: 'asc' } });
    assert.deepEqual(stored.map((s) => [s.inn, s.mfo]), [['200935935', '00014'], ['302345678', '00873']]);

    const narrow = await sheet([['Наименование', 'ИНН', 'Полное наименование', 'Код'], ['Альфа', '301111111', 'ООО "Альфа Савдо"', '000000123']]);
    const n = await importCounterparties(orgId, null, narrow, 'spisok.xlsx');
    assert.deepEqual(n, { ok: true, rows: 1, created: 1, updated: 0, skipped: 0, errors: [] });
    const alfa = await db.counterparty.findFirstOrThrow({ where: { orgId, inn: '301111111' } });
    assert.deepEqual([alfa.name, alfa.onecRef], ['Альфа', '000000123']);
  });
});
