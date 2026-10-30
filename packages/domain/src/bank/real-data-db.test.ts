// The 30 Oct fixes against the database: processing resumes after a restart (B3), a re-import of
// an overlapping period adds no new payment (bank research §7.42), and a bank's own kl_to_1c.txt
// whose printed totals disagree with its documents is reported and still exported (B6, §7.15).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';
import { db } from '@tasnivo/db';
import iconv from 'iconv-lite';
import JSZip from 'jszip';
import type { UploadedFile } from '../catalog-upload.js';
import { makePerson } from '../firm-test-fixtures.js';
import type { CurrentUser } from '../session.js';
import { dbSkipReason, dropOrgs, makeOrg } from '../test-fixtures.js';
import { parseBankExchange } from '../onec/bank-exchange.js';
import { setOperationSuggester } from './ai.js';
import { readLines, readStatementFile } from './read.js';
import {
  approveMany, claimStalled, createStatement, exportStatement, prepareStatement, previewStatement, processing, reconcileStatement, STALL_MS, statementDetail,
} from './service.js';
import { batchMeta, isRunning, storeLines } from './store.js';

const skip = await dbSkipReason();

const upload = (name: string, bytes: Buffer): UploadedFile => ({ name, size: bytes.length, read: () => Promise.resolve(bytes) });
const bankFixture = (name: string): Buffer => readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
const exchangeSample = (name: string): Buffer => readFileSync(new URL(`../onec/fixtures/bank-input/${name}`, import.meta.url));

describe('bank statements from real material (database)', { skip }, () => {
  const orgs: string[] = [];
  let admin: CurrentUser;

  before(async () => {
    setOperationSuggester(null);
    const org = await makeOrg();
    orgs.push(org.orgId);
    await db.organization.update({ where: { id: org.orgId }, data: { subscriptionUntil: new Date(Date.now() + 86_400_000) } });
    admin = { ...(await makePerson(org.orgId, 'admin')), demo: false, clientId: null, clientIds: null };
  });
  after(async () => {
    setOperationSuggester(undefined);
    await dropOrgs(orgs);
    await db.$disconnect();
  });

  const read = async (file: UploadedFile): Promise<string> => {
    const preview = await previewStatement(admin, 'uz', { clientId: '', file });
    assert.ok(preview.ok, JSON.stringify(preview));
    const created = await createStatement(admin, 'uz', { clientId: '', file, columnMap: JSON.stringify(preview.preview.columnMap), conventions: JSON.stringify(preview.preview.conventions) });
    assert.ok(created.ok, JSON.stringify(created));
    await processing(created.batchId);
    return created.batchId;
  };

  it('B3: a statement left "uploaded" by a stopped API is picked up at its progress by the next read', async () => {
    // The lines are stored first; the process then "stops" after the first two of four were processed.
    const bytes = bankFixture('asbt-documents-fixed.txt');
    const file = await readStatementFile(bytes);
    assert.ok(file.builtIn);
    const parsed = readLines(file, file.builtIn.layout);
    const batch = await db.importBatch.create({ data: { orgId: admin.orgId, kind: 'bank_statement', source: 'upload', filename: 'restart.txt', fingerprint: `restart-${Date.now()}`, status: 'uploaded', createdBy: admin.userId }, select: { id: true } });
    await storeLines(batch.id, parsed);
    const stored = await db.importBatch.findUniqueOrThrow({ where: { id: batch.id }, select: { meta: true } });
    const meta = batchMeta(stored.meta);
    assert.deepEqual(meta?.bank.progress, { done: 0, total: 4 }, 'every line is in the database before processing');
    await db.importBatch.update({ where: { id: batch.id }, data: { meta: { ...meta, bank: { ...meta?.bank, progress: { done: 2, total: 4 } } } } });
    // Ninety seconds without progress: the API that ran it is gone.
    await db.$executeRaw`UPDATE import_batch SET "updatedAt" = now() - (${STALL_MS + 5_000} * interval '1 millisecond') WHERE id = ${batch.id}`;

    const seen = await statementDetail(admin, batch.id);
    assert.equal(seen?.statement.status, 'uploaded');
    await processing(batch.id);
    assert.equal(isRunning(batch.id), false);
    const done = await statementDetail(admin, batch.id);
    assert.equal(done?.statement.status, 'review');
    const records = await db.importRecord.findMany({ where: { batchId: batch.id }, orderBy: { rowIndex: 'asc' }, select: { issues: true } });
    const matched = records.map((r) => (r.issues as { code: string }[]).some((i) => i.code.startsWith('counterparty_') || i.code === 'operation_missing'));
    assert.deepEqual(matched, [false, false, true, true], 'the run resumed after the two lines already done, it did not start over');
  });

  it('B3: a statement whose upload stopped while its lines were stored fails, saying so, instead of passing as complete', async () => {
    // Review 30 Oct: the batch is created "uploaded" (0 of n) before its lines are written; a crash in between left
    // part of the lines, and the resume processed them as the whole statement.
    const file = await readStatementFile(bankFixture('asbt-documents-fixed.txt'));
    assert.ok(file.builtIn);
    const parsed = readLines(file, file.builtIn.layout);
    const batch = await db.importBatch.create({ data: { orgId: admin.orgId, kind: 'bank_statement', source: 'upload', filename: 'cut.txt', fingerprint: `cut-${Date.now()}`, status: 'uploaded', createdBy: admin.userId }, select: { id: true } });
    await storeLines(batch.id, parsed);
    // The crash: two of the four stored lines never reached the database.
    const [, , ...lost] = await db.importRecord.findMany({ where: { batchId: batch.id }, orderBy: { rowIndex: 'asc' }, select: { id: true } });
    await db.importRecord.deleteMany({ where: { id: { in: lost.map((r) => r.id) } } });
    await db.$executeRaw`UPDATE import_batch SET "updatedAt" = now() - (${STALL_MS + 5_000} * interval '1 millisecond') WHERE id = ${batch.id}`;
    await statementDetail(admin, batch.id);
    await processing(batch.id);
    const after = await db.importBatch.findUniqueOrThrow({ where: { id: batch.id }, select: { status: true, error: true } });
    assert.equal(after.status, 'failed');
    assert.match(after.error ?? '', /stored 2 of 4 lines/);
  });

  it('B3: of two processes resuming one stalled statement, one takes it over', async () => {
    // Review 30 Oct (R-B9): the in-process guard does not see another API process; the claim is one conditional UPDATE.
    const batch = await db.importBatch.create({ data: { orgId: admin.orgId, kind: 'bank_statement', source: 'upload', filename: 'claim.txt', fingerprint: `claim-${Date.now()}`, status: 'uploaded', createdBy: admin.userId }, select: { id: true } });
    await db.$executeRaw`UPDATE import_batch SET "updatedAt" = now() - (${STALL_MS + 5_000} * interval '1 millisecond') WHERE id = ${batch.id}`;
    assert.deepEqual((await Promise.all([claimStalled(batch.id), claimStalled(batch.id)])).sort(), [false, true]);
    assert.equal(await claimStalled(batch.id), false, 'taken over: no longer stalled');
  });

  it('a re-import of an overlapping period adds no new payment: only the one outside the first file is new', async () => {
    // bank §7.42 §7.24 (Fintablo «Хранилище дублей»); the second file is the same ASBT export one day longer.
    const first = await read(upload('asbt-documents-pipe.zip', bankFixture('asbt-documents-pipe.zip')));
    const zip = await JSZip.loadAsync(bankFixture('asbt-documents-pipe.zip'));
    const text = iconv.decode(await zip.file('vypiska301026.txt')!.async('nodebuffer'), 'win1251');
    const longer = `${text}5|31.10.2026|20208000700111222001|304567890|XK «Samarqand Non»|00873|20208000900123456001|301234567|ООО «Тасниво Тест»|00444|120000.00|00664|Оплата за поставку\r\n`;
    const second = await read(upload('vypiska311026.txt', iconv.encode(longer, 'win1251')));
    assert.notEqual(first, second);
    const records = await db.importRecord.findMany({ where: { batchId: second }, orderBy: { rowIndex: 'asc' }, select: { issues: true } });
    const earlier = (await db.importBatch.findMany({ where: { orgId: admin.orgId, id: { not: second } }, select: { id: true } })).map((b) => b.id);
    assert.ok(earlier.includes(first));
    const duplicate = records.map((r) => (r.issues as { code: string; params?: { batchId?: string } }[]).find((i) => i.code === 'duplicate_pending')?.params?.batchId ?? null);
    assert.deepEqual(duplicate.map((b) => b !== null && earlier.includes(b)), [true, true, true, true, false], 'four already imported (in an earlier statement), one new');
  });

  it('B6: a kl_to_1c.txt whose printed turnovers disagree is reported in the reconcile and the dry run, and still exports', async () => {
    // bank §7.15: report the mismatch, do not block (habr sample: printed 68 770 / 68 770, documents 4 520 / 4 770).
    const batchId = await read(upload('kl_to_1c.txt', exchangeSample('habr-245397.kl_to_1c.txt')));
    const report = await reconcileStatement(admin, batchId);
    assert.deepEqual([report?.openingBalance, report?.closingBalance, report?.difference, report?.balanced], ['0', '0', '250', false]);
    assert.deepEqual([report?.bankTotals.debit, report?.bankTotals.credit, report?.bankTotals.debitMatches, report?.bankTotals.creditMatches], ['68770', '68770', false, false]);
    const approved = await approveMany(admin, 'uz', batchId, { scope: 'reviewable' });
    assert.ok(approved.ok && approved.approved === 4, JSON.stringify(approved));
    const prep = await prepareStatement(admin, 'uz', batchId);
    assert.ok(prep.ok);
    assert.deepEqual(prep.checks.filter((c) => !c.ok).map((c) => c.code), ['balance_reconciles', 'bank_totals_match']);
    const out = await exportStatement(admin, 'uz', batchId);
    assert.ok(out.ok, JSON.stringify(out));
    const file = parseBankExchange(out.file.body);
    assert.equal(file.documents.length, 4);
    assert.deepEqual(file.documents.map((d) => d['Номер']), ['1', '176', '1', '1/2'], 'the bank\'s repeated number 1 of 10.01.2014 made unique per file');
  });
});
