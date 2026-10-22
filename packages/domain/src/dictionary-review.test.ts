import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { db } from './db.js';
import { approverEmails, dictionaryCounts, dictionaryWhere, parseDictFilter, retiredEntryCodes } from './dictionary-review.js';
import { makePerson, type Person } from './firm-test-fixtures.js';
import { dbSkipReason, dropOrgs, liveCodes, makeOrg, type TestActor } from './test-fixtures.js';

describe('dictionary filters (pure)', () => {
  it('knows its views and falls back to all', () => {
    assert.equal(parseDictFilter('stale'), 'stale');
    assert.equal(parseDictFilter('x'), 'all');
    assert.equal(parseDictFilter(undefined), 'all');
  });

  it('always scopes the query to the org, whatever the view or the search', () => {
    for (const f of ['all', 'confirmed', 'unverified', 'stale'] as const) {
      const where = JSON.stringify(dictionaryWhere('org-1', f, ['123'], 'sut'));
      assert.ok(where.includes('"orgId":"org-1"'), f);
    }
  });
});

const skip = await dbSkipReason();

describe('dictionary review (database)', { skip }, () => {
  let a: TestActor;
  let b: TestActor;
  let teacher: Person;
  let codes: string[] = [];

  const entry = (orgId: string, key: string, data: { code?: string; confirmations?: number; staleAt?: Date | null; updatedBy?: string | null }) =>
    db.firmMapping.create({
      data: { orgId, kind: 'name', key, label: key, code: data.code ?? codes[0] ?? '', confirmations: data.confirmations ?? 0, staleAt: data.staleAt ?? null, updatedBy: data.updatedBy ?? null, source: 'bulk' },
    });

  before(async () => {
    codes = await liveCodes(2);
    a = await makeOrg();
    b = await makeOrg();
    teacher = await makePerson(a.orgId, 'accountant');
    await entry(a.orgId, 'tasdiqlangan sut', { confirmations: 2, updatedBy: teacher.userId });
    await entry(a.orgId, 'ommaviy non', { confirmations: 0 });
    await entry(a.orgId, 'eski kod', { staleAt: new Date(), confirmations: 3 });
    await entry(b.orgId, 'boshqa firma sut', { confirmations: 5 });
  });
  after(async () => {
    await dropOrgs([a.orgId, b.orgId]);
    await db.$disconnect();
  });

  const labels = async (orgId: string, filter: 'all' | 'confirmed' | 'unverified' | 'stale', q = ''): Promise<string[]> =>
    (await db.firmMapping.findMany({ where: dictionaryWhere(orgId, filter, await retiredEntryCodes(orgId), q), select: { label: true }, orderBy: { label: 'asc' } })).map((r) => r.label);

  it('sorts entries into confirmed, unverified and stale, and never mixes orgs', async () => {
    assert.deepEqual(await labels(a.orgId, 'confirmed'), ['tasdiqlangan sut']);
    assert.deepEqual(await labels(a.orgId, 'unverified'), ['ommaviy non']);
    assert.deepEqual(await labels(a.orgId, 'stale'), ['eski kod'], 'a flagged entry is stale even with confirmations');
    assert.deepEqual(await labels(a.orgId, 'all'), ['eski kod', 'ommaviy non', 'tasdiqlangan sut']);
    assert.deepEqual(await labels(b.orgId, 'all'), ['boshqa firma sut']);
    assert.deepEqual(await labels(a.orgId, 'all', 'sut'), ['tasdiqlangan sut'], 'search narrows within the org only');
  });

  it('counts each view for the chips', async () => {
    assert.deepEqual(await dictionaryCounts(a.orgId), { all: 3, confirmed: 1, unverified: 1, stale: 1 });
    assert.deepEqual(await dictionaryCounts(a.orgId, 'non'), { all: 1, confirmed: 0, unverified: 1, stale: 0 });
    assert.deepEqual(await dictionaryCounts(b.orgId), { all: 1, confirmed: 1, unverified: 0, stale: 0 });
  });

  it('names an approver only when they belong to the same org', async () => {
    const names = await approverEmails(a.orgId, [teacher.userId, null, b.userId]);
    assert.equal(names.get(teacher.userId), teacher.email);
    assert.equal(names.has(b.userId), false, 'a user of another firm is never resolved');
    assert.equal((await approverEmails(a.orgId, [null])).size, 0);
  });

  it('treats an entry pointing at a retired code as stale even before an audit flags it', async () => {
    const retired = await db.$queryRaw<{ code: string }[]>`SELECT code FROM mxik_code WHERE "retiredAt" IS NOT NULL LIMIT 1`;
    const code = retired[0]?.code.trim();
    if (!code) return; // this database has no retired codes to test with
    await entry(a.orgId, 'arxiv kodli', { code, confirmations: 1 });
    assert.ok((await retiredEntryCodes(a.orgId)).includes(code));
    assert.ok((await labels(a.orgId, 'stale')).includes('arxiv kodli'));
    assert.ok(!(await labels(a.orgId, 'confirmed')).includes('arxiv kodli'));
    assert.equal((await retiredEntryCodes(b.orgId)).includes(code), false);
  });
});
