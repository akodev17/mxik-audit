// The bank statement workflow against the development database: preview, read (processing in
// chunks), a duplicate file refused, a manual mapping remembered as the org's layout, decisions
// with a remembered rule, bulk approval, the 1C dry run and export through the onec interface
// (the base-commit stub answers not_implemented until Agent 1 lands), duplicates against exported
// lines, the retry rule (exported is final), reconciliation, removal and access.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';
import { db } from '@tasnivo/db';
import { i18nFor } from '@tasnivo/i18n/locale';
import type { UploadedFile } from '../catalog-upload.js';
import { makeClient, makePerson } from '../firm-test-fixtures.js';
import type { CurrentUser } from '../session.js';
import { dbSkipReason, dropOrgs, makeOrg } from '../test-fixtures.js';
import { setOperationSuggester, type OperationSuggester } from './ai.js';
import {
  approveMany, bankFormats, bankRules, createStatement, decideRecord, exportStatement, listStatements, prepareStatement, previewStatement, processing,
  reconcileCsvFile, reconcileStatement, removeBankFormat, removeStatement, statementDetail, statementRecords,
} from './service.js';

const skip = await dbSkipReason();
const { ta } = i18nFor('uz');
const e = ta.bankX.errors;

const fixture = (name: string): UploadedFile => {
  const bytes = readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
  return { name, size: bytes.length, read: () => Promise.resolve(bytes) };
};
const csv = (name: string, text: string): UploadedFile => {
  const bytes = Buffer.from(text, 'utf8');
  return { name, size: bytes.length, read: () => Promise.resolve(bytes) };
};

describe('bank statements (database)', { skip }, () => {
  const orgs: string[] = [];
  let admin: CurrentUser;
  let viewer: CurrentUser;
  let stranger: CurrentUser;
  let clientId = '';

  before(async () => {
    setOperationSuggester(null);
    const org = await makeOrg();
    orgs.push(org.orgId);
    await db.organization.update({ where: { id: org.orgId }, data: { subscriptionUntil: new Date(Date.now() + 86_400_000) } });
    admin = { ...(await makePerson(org.orgId, 'admin')), demo: false, clientId: null, clientIds: null };
    viewer = { ...(await makePerson(org.orgId, 'viewer')), demo: false, clientId: null, clientIds: null };
    clientId = await makeClient(org.orgId, 'Bank mijoz');
    const other = await makeOrg();
    orgs.push(other.orgId);
    stranger = { ...(await makePerson(other.orgId, 'admin')), demo: false, clientId: null, clientIds: null };
  });
  after(async () => {
    setOperationSuggester(undefined);
    await dropOrgs(orgs);
    await db.$disconnect();
  });

  const read = async (file: UploadedFile, client: string | null = clientId) => {
    const preview = await previewStatement(admin, 'uz', { clientId: client ?? '', file });
    assert.ok(preview.ok, JSON.stringify(preview));
    const created = await createStatement(admin, 'uz', {
      clientId: client ?? '', file, columnMap: JSON.stringify(preview.preview.columnMap), conventions: JSON.stringify(preview.preview.conventions),
    });
    assert.ok(created.ok, JSON.stringify(created));
    await processing(created.batchId);
    return { preview: preview.preview, batchId: created.batchId };
  };

  let ruBatch = '';

  it('preview: the RU fixture is recognised, nothing is stored', async () => {
    const before = await db.importBatch.count({ where: { orgId: admin.orgId } });
    const p = await previewStatement(admin, 'uz', { clientId, file: fixture('ru-debit-credit.xlsx') });
    assert.ok(p.ok);
    assert.equal(p.preview.recognised, true);
    assert.equal(p.preview.format?.id, 'generic_ru_debit_credit');
    assert.equal(p.preview.format?.verified, false);
    assert.equal(p.preview.dataRows, 10);
    assert.deepEqual(p.preview.dropped.map((d) => d.reason), ['column_numbers', 'continuation', 'totals', 'closing_balance', 'footer']);
    assert.equal(p.preview.header.openingBalance, '15000000');
    assert.equal(p.preview.duplicateOf, null);
    assert.equal(await db.importBatch.count({ where: { orgId: admin.orgId } }), before);
  });

  it('read: 10 records, header meta, counts, statuses, rules applied, counterparty stub warns', async () => {
    const { batchId } = await read(fixture('ru-debit-credit.xlsx'));
    ruBatch = batchId;
    const detail = await statementDetail(admin, batchId);
    assert.ok(detail);
    const s = detail.statement;
    assert.equal(s.status, 'review');
    assert.equal(s.counts?.total, 10);
    assert.equal(s.formatId, 'generic_ru_debit_credit');
    assert.deepEqual([s.account, s.periodFrom, s.periodTo, s.openingBalance, s.closingBalance], ['20208000900123456001', '2026-10-01', '2026-10-31', '15000000', '24405346']);
    assert.equal(s.progress, null, 'finished');
    const page = await statementRecords(admin, batchId, { status: 'all' });
    assert.equal(page?.total, 10);
    const byRow = new Map(page?.records.map((r) => [r.rowIndex, r]));
    assert.equal(byRow.get(14)?.payload.operation, 'bank_fee');
    assert.equal(byRow.get(15)?.payload.operation, 'acquiring');
    assert.equal(byRow.get(16)?.payload.operation, 'tax');
    assert.equal(byRow.get(17)?.payload.operation, 'salary');
    assert.equal(byRow.get(21)?.payload.operation, 'transfer');
    assert.equal(byRow.get(12)?.payload.operation, 'payment_in');
    assert.equal(byRow.get(12)?.payload.decidedBy, 'rule:builtin:counterparty_in');
    // The 1C interface is the base-commit stub: matching answers "unknown" → a warning, never a guess.
    assert.ok(byRow.get(12)?.issues.some((i) => i.code === 'counterparty_unknown' && i.severity === 'warning'));
    assert.equal(byRow.get(12)?.payload.counterparty.counterpartyId, null);
    assert.equal(byRow.get(14)?.status, 'valid', 'a bank fee without a counterparty is not suspicious');
    const sum = (s.counts?.valid ?? 0) + (s.counts?.suspicious ?? 0) + (s.counts?.unresolved ?? 0);
    assert.equal(sum, 10);
  });

  it('the same file again is refused, naming the earlier statement', async () => {
    const again = await createStatement(admin, 'uz', { clientId, file: fixture('ru-debit-credit.xlsx'), columnMap: '{"date":0,"debit":6,"credit":7}', conventions: '{"dateOrder":"dmy","decimal":"auto","direction":"columns","negativeIs":"debit","currency":"UZS"}' });
    assert.deepEqual(again, { ok: false, error: e.duplicate, duplicateOf: ruBatch });
    const p = await previewStatement(admin, 'uz', { clientId, file: fixture('ru-debit-credit.xlsx') });
    assert.ok(p.ok);
    assert.equal(p.preview.duplicateOf?.batchId, ruBatch);
  });

  it('a manual mapping is saved as the org\'s layout and recognises the next file of that bank', async () => {
    const text = (n: string) => `Kun;Hamkor;STIR;Pul;Turi;Izoh\n0${n}.10.2026;Alfa;302345678;1000,00;K;To'lov\n0${n}.10.2026;Beta;303456789;250,50;D;Xizmat\n`;
    const first = await previewStatement(admin, 'uz', { clientId, file: csv('kun.csv', text('1')) });
    assert.ok(first.ok);
    assert.equal(first.preview.recognised, false);
    assert.equal(first.preview.format, null);
    const columnMap = { date: 0, counterpartyName: 1, inn: 2, amount: 3, direction: 4, purpose: 5 };
    const conventions = { dateOrder: 'dmy', decimal: 'auto', direction: 'flag', negativeIs: 'debit', currency: 'UZS' };
    const bad = await createStatement(admin, 'uz', { clientId, file: csv('kun.csv', text('1')), columnMap: JSON.stringify({ date: 0, amount: 3 }), conventions: JSON.stringify(conventions) });
    assert.deepEqual(bad, { ok: false, error: e.badMapping }, 'a flag convention without a flag column');
    const created = await createStatement(admin, 'uz', { clientId, file: csv('kun.csv', text('1')), columnMap: JSON.stringify(columnMap), conventions: JSON.stringify(conventions), formatName: 'Hamkor bank' });
    assert.ok(created.ok);
    await processing(created.batchId);
    const records = await statementRecords(admin, created.batchId, {});
    assert.deepEqual(records?.records.map((r) => [r.payload.direction, r.payload.amount]), [['credit', '1000'], ['debit', '250.5']]);

    const second = await previewStatement(admin, 'uz', { clientId, file: csv('kun2.csv', text('2')) });
    assert.ok(second.ok);
    assert.equal(second.preview.recognised, true);
    assert.equal(second.preview.format?.name, 'Hamkor bank');
    assert.equal(second.preview.format?.builtIn, false);
    assert.deepEqual(second.preview.columnMap, { ...columnMap, docNumber: -1, debit: -1, credit: -1, account: -1, mfo: -1, reference: -1, currency: -1 });
    const read2 = await createStatement(admin, 'uz', { clientId, file: csv('kun2.csv', text('2')), columnMap: JSON.stringify(second.preview.columnMap), conventions: JSON.stringify(second.preview.conventions) });
    assert.ok(read2.ok);
    await processing(read2.batchId);
    assert.equal((await statementDetail(admin, read2.batchId))?.statement.formatName, 'Hamkor bank');
    const formats = await bankFormats(admin);
    const saved = formats.find((f) => f.name === 'Hamkor bank');
    assert.equal(saved?.usedCount, 1);
    assert.ok(formats.some((f) => f.id === 'generic_ru_debit_credit' && f.builtIn));
    assert.deepEqual(await removeBankFormat(stranger, 'uz', saved?.id ?? ''), { ok: false, error: e.notFound }, 'another org cannot remove it');
  });

  it('decisions: correct the operation and remember it for the counterparty; the twin line follows', async () => {
    const page = await statementRecords(admin, ruBatch, {});
    const first = page?.records.find((r) => r.rowIndex === 12);
    assert.ok(first);
    const res = await decideRecord(admin, 'uz', first.id, { action: 'correct', corrections: { operation: 'loan', cashFlowItem: 'Займы' }, remember: { by: 'counterparty' } });
    assert.ok(res.ok, JSON.stringify(res));
    assert.equal(res.record.status, 'corrected');
    assert.equal(res.record.payload.decidedBy, 'manual');
    assert.equal(res.applied, 1, 'row 20 is the same counterparty');
    assert.ok(res.ruleId);
    const twin = (await statementRecords(admin, ruBatch, {}))?.records.find((r) => r.rowIndex === 20);
    assert.deepEqual([twin?.payload.operation, twin?.payload.cashFlowItem, twin?.payload.decidedBy], ['loan', 'Займы', `rule:${res.ruleId}`]);
    const rules = await bankRules(admin);
    assert.deepEqual(rules.map((r) => [r.kind, r.value, r.operation, r.hits, r.clientId]), [['inn_equals', '302345678', 'loan', 1, clientId]]);
    assert.deepEqual(await decideRecord(admin, 'uz', first.id, { action: 'correct', corrections: { operation: 'nonsense' } }), { ok: false, error: e.badValue('operation') });
    assert.deepEqual(await decideRecord(viewer, 'uz', first.id, { action: 'approve' }), { ok: false, error: e.client });
    assert.deepEqual(await decideRecord(stranger, 'uz', first.id, { action: 'approve' }), { ok: false, error: e.notFound });
  });

  it('an unresolved line cannot be approved until corrected; skip and reopen', async () => {
    const { batchId } = await read(fixture('uz-debit-credit.xlsx'));
    const lines = (await statementRecords(admin, batchId, { status: 'unresolved' }))?.records ?? [];
    assert.deepEqual(lines.map((l) => l.rowIndex), [13, 15, 16, 17]);
    const bad = lines.find((l) => l.rowIndex === 13);
    assert.ok(bad);
    assert.deepEqual(await decideRecord(admin, 'uz', bad.id, { action: 'approve' }), { ok: false, error: e.unresolved });
    assert.deepEqual(await decideRecord(admin, 'uz', bad.id, { action: 'correct', corrections: { date: '31.02.2026' } }), { ok: false, error: e.badValue('date') });
    const fixed = await decideRecord(admin, 'uz', bad.id, { action: 'approve', corrections: { date: '07.10.2026' } });
    assert.ok(fixed.ok, JSON.stringify(fixed));
    assert.equal(fixed.record.payload.date, '2026-10-07');
    assert.equal(fixed.record.decision?.action, 'approve');
    assert.ok(!fixed.record.issues.some((i) => i.code === 'date_invalid'));
    const both = lines.find((l) => l.rowIndex === 15);
    assert.ok(both);
    const skipped = await decideRecord(admin, 'uz', both.id, { action: 'skip', note: 'Storno' });
    assert.ok(skipped.ok);
    assert.equal(skipped.record.status, 'skipped');
    const reopened = await decideRecord(admin, 'uz', both.id, { action: 'reopen' });
    assert.ok(reopened.ok);
    assert.equal(reopened.record.status, 'unresolved');
  });

  it('bulk approval: valid lines only, then everything without an error; prepare and export through the 1C interface', async () => {
    const valid = await approveMany(admin, 'uz', ruBatch, { scope: 'valid' });
    assert.ok(valid.ok);
    const counts = (await statementDetail(admin, ruBatch))?.statement;
    assert.equal(counts?.approved, valid.approved);
    const rest = await approveMany(admin, 'uz', ruBatch, { scope: 'reviewable' });
    assert.ok(rest.ok);
    assert.equal(valid.approved + rest.approved, 10, 'the RU fixture has no errors');
    const after = (await statementDetail(admin, ruBatch))?.statement;
    assert.equal(after?.status, 'approved');
    assert.equal(after?.counts?.suspicious, 0, 'approving accepts the warnings: the 1C layer exports valid and corrected lines');
    assert.equal((after?.counts?.valid ?? 0) + (after?.counts?.corrected ?? 0), 10);

    const prep = await prepareStatement(admin, 'uz', ruBatch);
    assert.ok(prep.ok, JSON.stringify(prep));
    assert.equal(prep.ready, 10);
    assert.deepEqual(prep.checks.map((c) => [c.code, c.ok]), [['ready', true], ['balance_reconciles', true], ['bank_totals_match', true], ['no_unresolved', true], ['no_exported_duplicates', true]]);
    assert.deepEqual(prep.onec, { ok: false, error: 'not_implemented' }, 'the base-commit stub');
    const exported = await exportStatement(admin, 'uz', ruBatch);
    assert.deepEqual(exported, { ok: false, status: 501, code: 'not_implemented', message: e.onecUnavailable });
  });

  it('exported is final: a retry sends only the rest, decisions are refused, the next statement flags the duplicate', async () => {
    // Agent 1's buildExport marks what it wrote; until it lands, do what it will do for five lines.
    const firstFive = (await statementRecords(admin, ruBatch, {}))?.records.slice(0, 5) ?? [];
    await db.importRecord.updateMany({ where: { id: { in: firstFive.map((r) => r.id) } }, data: { status: 'exported' } });
    const prep = await prepareStatement(admin, 'uz', ruBatch);
    assert.ok(prep.ok);
    assert.deepEqual([prep.ready, prep.alreadyExported], [5, 5]);
    assert.deepEqual(await decideRecord(admin, 'uz', firstFive[0]?.id ?? '', { action: 'reopen' }), { ok: false, error: e.exported });
    assert.deepEqual(await removeStatement(admin, 'uz', ruBatch), { ok: false, error: e.removeExported });

    // A later statement of the same account repeats row 12 (2026-10-01, 12 500 000 credit, doc 15, ИНН 302345678).
    const overlap = csv('overlap.csv', 'Счет: 20208000900123456001\nДата;№ док;Контрагент;ИНН;Дебет;Кредит;Назначение\n01.10.2026;15;ООО «Альфа Трейд»;302345678;;12 500 000,00;Оплата\n02.11.2026;30;ООО «Альфа Трейд»;302345678;;1 000,00;Оплата\n');
    const { batchId } = await read(overlap);
    const lines = (await statementRecords(admin, batchId, {}))?.records ?? [];
    const dup = lines.find((l) => l.payload.docNumber === '15');
    assert.deepEqual(dup?.issues.find((i) => i.code === 'duplicate_row')?.params, { source: 'exported', batchId: ruBatch });
    assert.equal(dup?.status, 'suspicious');
    assert.ok(!lines.find((l) => l.payload.docNumber === '30')?.issues.some((i) => i.code.startsWith('duplicate')));
  });

  it('a line repeated in the same file is flagged with the earlier row', async () => {
    const { batchId } = await read(fixture('amount-direction.xlsx'));
    const lines = (await statementRecords(admin, batchId, {}))?.records ?? [];
    const second = lines.find((l) => l.rowIndex === 11);
    assert.deepEqual(second?.issues.find((i) => i.code === 'duplicate_row')?.params, { source: 'file', row: 6 });
  });

  it('reconciliation report and CSV', async () => {
    const report = await reconcileStatement(admin, ruBatch);
    assert.ok(report);
    assert.equal(report.balanced, true);
    assert.equal(report.computedClosing, '24405346');
    assert.equal(report.exported, 5);
    assert.ok(report.byOperation.some((o) => o.key === 'loan' && o.count === 2));
    const file = await reconcileCsvFile(admin, 'ru', ruBatch);
    assert.ok(file.ok);
    assert.match(file.file.headers['content-type'] ?? '', /text\/csv/);
    assert.ok(String(file.file.body).includes('Кредиты и займы'));
    assert.equal(await reconcileStatement(stranger, ruBatch), null);
  });

  it('AI suggestions are attached to undecided lines only, as info with basis ai', async () => {
    const calls: string[][] = [];
    const fake: OperationSuggester = {
      name: 'fake',
      suggest: (rows) => {
        calls.push(rows.map((r) => r.id));
        return Promise.resolve(new Map(rows.map((r) => [r.id, { operation: 'other_out' as const, confidence: 0.7, reason: 'test' }])));
      },
    };
    const file = csv('ai.csv', 'Дата;Сумма;Назначение\n01.10.2026;-100,00;Перевод\n02.10.2026;-50,00;Комиссия банка\n');
    const p = await previewStatement(admin, 'uz', { clientId, file });
    assert.ok(p.ok);
    const created = await createStatement(admin, 'uz', { clientId, file, columnMap: JSON.stringify(p.preview.columnMap), conventions: JSON.stringify(p.preview.conventions) }, { suggester: fake });
    assert.ok(created.ok);
    await processing(created.batchId);
    assert.equal(calls.length, 1);
    const lines = (await statementRecords(admin, created.batchId, {}))?.records ?? [];
    const undecided = lines.find((l) => l.payload.purpose === 'Перевод');
    assert.equal(undecided?.payload.operation, null, 'never applied');
    assert.deepEqual([undecided?.payload.operationSuggestion?.basis, undecided?.payload.operationSuggestion?.id], ['ai', 'other_out']);
    assert.ok(undecided?.issues.some((i) => i.code === 'operation_suggested' && i.severity === 'info' && i.suggestion === 'other_out'));
    assert.equal(lines.find((l) => l.payload.purpose === 'Комиссия банка')?.payload.operationSuggestion, null, 'a rule decided it; not sent');
  });

  it('access: list by client, refusals for viewers and other orgs, removal', async () => {
    const all = await listStatements(admin);
    assert.ok(all.length >= 5);
    assert.ok(all.every((s) => s.clientId === clientId));
    assert.deepEqual(await listStatements(admin, 'another-client'), []);
    assert.deepEqual(await listStatements(stranger), []);
    assert.equal(await statementDetail(stranger, ruBatch), null);
    const v = await previewStatement(viewer, 'uz', { clientId, file: fixture('uz-debit-credit.xlsx') });
    assert.deepEqual(v, { ok: false, error: e.client });
    const none = await previewStatement(admin, 'uz', { clientId, file: null });
    assert.deepEqual(none, { ok: false, error: e.none });
    const legacy = await previewStatement(admin, 'uz', { clientId, file: { name: 'old.xls', size: 8, read: () => Promise.resolve(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0, 0, 0, 0])) } });
    assert.deepEqual(legacy, { ok: false, error: e.legacy_xls });
    const removable = all.find((s) => s.id !== ruBatch);
    assert.ok(removable);
    assert.deepEqual(await removeStatement(viewer, 'uz', removable.id), { ok: false, error: e.client });
    assert.deepEqual(await removeStatement(admin, 'uz', removable.id), { ok: true });
    assert.equal(await statementDetail(admin, removable.id), null);
  });
});
