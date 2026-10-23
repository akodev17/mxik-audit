// endpoints.bank through the real app against the development database: preview, read with the
// chosen columns, progress, the review records, a decision with a remembered rule, bulk approval,
// the 1C dry run and export (the onec interface is the base-commit stub until Agent 1 lands:
// 501 not_implemented), reconciliation and its CSV, layouts and rules, removal, and refusals.
import '../setup-env';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { endpoints } from '@tasnivo/contracts';
import { db } from '@tasnivo/db';
import { setOperationSuggester } from '@tasnivo/domain/bank/ai';
import { makeClient, makePerson } from '@tasnivo/domain/firm-test-fixtures';
import { i18nFor } from '@tasnivo/i18n/locale';
import { bodyOf, dbSkipReason, dropOrgs, makeUser, serverOf, startApp, type TestUser } from '../helpers';
import { binary, eventually, matches, sessionCookie } from '../upload-fixtures';

const skip = await dbSkipReason();
const b = endpoints.bank;
const { ta } = i18nFor('uz');
const fixture = (name: string): Buffer => readFileSync(new URL(`../../../../packages/domain/src/bank/fixtures/${name}`, import.meta.url));

type Preview = { ok: true; preview: { columnMap: Record<string, number>; conventions: Record<string, string>; recognised: boolean; format: { id: string } | null; dataRows: number } };

describe('bank (database)', { skip }, () => {
  let app: INestApplication;
  const orgs: string[] = [];
  let owner: TestUser;
  let cookie = '';
  let clientId = '';
  let batchId = '';

  const http = () => request(serverOf(app));
  const send = (method: 'post' | 'put' | 'delete', path: string, who = cookie) => http()[method](path).set('Cookie', who).set('X-Requested-With', 'tasnivo');

  before(async () => {
    setOperationSuggester(null);
    app = await startApp();
    owner = await makeUser();
    orgs.push(owner.orgId);
    await db.organization.update({ where: { id: owner.orgId }, data: { subscriptionUntil: new Date(Date.now() + 30 * 86_400_000) } });
    clientId = await makeClient(owner.orgId, 'Bank mijoz');
    cookie = await sessionCookie(owner);
  });
  after(async () => {
    setOperationSuggester(undefined);
    await app.close();
    await dropOrgs(orgs);
    await db.$disconnect();
  });

  it('preview → read → progress → records', async () => {
    const res = await send('post', '/api/bank/preview').field('clientId', clientId).attach('file', fixture('ru-debit-credit.xlsx'), 'vypiska.xlsx');
    assert.equal(res.status, 200, JSON.stringify(res.body));
    matches(b.preview.response, res.body, 'preview');
    const p = bodyOf<Preview>(res).preview;
    assert.equal(p.recognised, true);
    assert.equal(p.format?.id, 'generic_ru_debit_credit');
    assert.equal(p.dataRows, 10);

    const created = await send('post', '/api/bank/statements').field('clientId', clientId)
      .field('columnMap', JSON.stringify(p.columnMap)).field('conventions', JSON.stringify(p.conventions))
      .attach('file', fixture('ru-debit-credit.xlsx'), 'vypiska.xlsx');
    assert.equal(created.status, 200, JSON.stringify(created.body));
    matches(b.create.response, created.body, 'create');
    batchId = bodyOf<{ ok: true; batchId: string }>(created).batchId;

    const statement = await eventually(async () => {
      const r = await http().get(`/api/bank/statements/${batchId}`).set('Cookie', cookie);
      assert.equal(r.status, 200);
      matches(b.statement.response, r.body, 'statement');
      const s = bodyOf<{ statement: { status: string; counts: { total: number } | null } }>(r).statement;
      assert.notEqual(s.status, 'failed');
      return s.status === 'review' ? s : undefined;
    }, 60_000, 'the statement to be read');
    assert.equal(statement.counts?.total, 10);

    const list = await http().get('/api/bank/statements').query({ client: clientId }).set('Cookie', cookie);
    matches(b.list.response, list.body, 'list');
    assert.equal(bodyOf<{ statements: { id: string }[] }>(list).statements[0]?.id, batchId);

    const records = await http().get(`/api/bank/statements/${batchId}/records`).query({ status: 'all', page: '1' }).set('Cookie', cookie);
    assert.equal(records.status, 200);
    matches(b.records.response, records.body, 'records');
    assert.equal(bodyOf<{ total: number }>(records).total, 10);
    const search = await http().get(`/api/bank/statements/${batchId}/records`).query({ q: 'альфа' }).set('Cookie', cookie);
    assert.equal(bodyOf<{ total: number }>(search).total, 2, 'search by counterparty name, case-insensitive');
  });

  it('the same file again: refused with the earlier statement', async () => {
    const res = await send('post', '/api/bank/statements').field('clientId', clientId)
      .field('columnMap', '{"date":0,"debit":6,"credit":7}').field('conventions', '{"dateOrder":"dmy","decimal":"auto","direction":"columns","negativeIs":"debit","currency":"UZS"}')
      .attach('file', fixture('ru-debit-credit.xlsx'), 'vypiska.xlsx');
    assert.deepEqual(res.body, { ok: false, error: ta.bankX.errors.duplicate, duplicateOf: batchId });
  });

  it('a decision with a remembered rule, bulk approval, rules list', async () => {
    const records = bodyOf<{ records: { id: string; rowIndex: number }[] }>(await http().get(`/api/bank/statements/${batchId}/records`).set('Cookie', cookie)).records;
    const row = records.find((r) => r.rowIndex === 12);
    assert.ok(row);
    const res = await send('put', `/api/bank/records/${row.id}/decision`).send({ action: 'correct', corrections: { operation: 'other_in' }, remember: { by: 'purpose', value: 'по договору № 4/28' } });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    matches(b.decide.response, res.body, 'decide');
    assert.equal(bodyOf<{ applied: number }>(res).applied, 1);
    const bad = await send('put', `/api/bank/records/${row.id}/decision`).send({ action: 'nope' });
    assert.deepEqual(bad.body, { ok: false, error: ta.bankX.errors.badMapping });

    const approved = await send('post', `/api/bank/statements/${batchId}/approve`).send({ scope: 'reviewable' });
    matches(b.approve.response, approved.body, 'approve');
    assert.equal(bodyOf<{ approved: number }>(approved).approved, 10);

    const rules = await http().get('/api/bank/rules').set('Cookie', cookie);
    matches(b.rules.response, rules.body, 'rules');
    assert.deepEqual(bodyOf<{ rules: { kind: string; value: string }[] }>(rules).rules.map((r) => [r.kind, r.value]), [['purpose_contains', 'по договору № 4/28']]);
  });

  it('prepare and export go through the 1C interface (stub: not_implemented)', async () => {
    const prep = await send('post', `/api/bank/statements/${batchId}/prepare`);
    assert.equal(prep.status, 200);
    matches(b.prepare.response, prep.body, 'prepare');
    assert.deepEqual(bodyOf<{ onec: unknown }>(prep).onec, { ok: false, error: 'not_implemented' });
    const exp = await send('post', `/api/bank/statements/${batchId}/export`);
    assert.equal(exp.status, 501);
    assert.equal(bodyOf(exp).error.code, 'not_implemented');
    assert.equal(bodyOf(exp).error.message, ta.bankX.errors.onecUnavailable);
  });

  it('reconciliation and its CSV', async () => {
    const r = await http().get(`/api/bank/statements/${batchId}/reconcile`).set('Cookie', cookie);
    assert.equal(r.status, 200);
    matches(b.reconcile.response, r.body, 'reconcile');
    assert.equal(bodyOf<{ balanced: boolean }>(r).balanced, true);
    const file = await http().get(`/api/bank/statements/${batchId}/reconcile.csv`).set('Cookie', `${cookie}; mxik_locale=ru`).buffer(true).parse(binary);
    assert.equal(file.status, 200);
    assert.match(String(file.headers['content-type']), /text\/csv/);
    assert.ok(String(file.headers['content-disposition']).startsWith('attachment; '));
    assert.ok((file.body as Buffer).toString('utf8').includes('Входящий остаток'));
  });

  it('formats list; refusals for another org, a viewer and without a session; removal', async () => {
    const formats = await http().get('/api/bank/formats').set('Cookie', cookie);
    matches(b.formats.response, formats.body, 'formats');
    assert.ok(bodyOf<{ formats: { id: string }[] }>(formats).formats.some((f) => f.id === 'generic_amount_direction'));

    assert.equal((await http().get('/api/bank/statements')).status, 401);
    const stranger = await makeUser();
    orgs.push(stranger.orgId);
    const theirs = await sessionCookie(stranger);
    assert.equal((await http().get(`/api/bank/statements/${batchId}`).set('Cookie', theirs)).status, 404);
    assert.equal((await http().get(`/api/bank/statements/${batchId}/reconcile`).set('Cookie', theirs)).status, 404);
    assert.equal((await send('post', `/api/bank/statements/${batchId}/export`, theirs)).status, 404);
    const viewer = await sessionCookie(await makePerson(owner.orgId, 'viewer'));
    assert.equal((await send('post', '/api/bank/preview', viewer).attach('file', fixture('ru-debit-credit.xlsx'), 'x.xlsx')).status, 403, 'a viewer may not upload');
    assert.equal((await send('delete', `/api/bank/statements/${batchId}`, viewer)).status, 403);

    assert.deepEqual((await send('delete', `/api/bank/statements/${batchId}`)).body, { ok: true });
    assert.equal((await http().get(`/api/bank/statements/${batchId}`).set('Cookie', cookie)).status, 404);
  });
});
