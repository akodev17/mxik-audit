import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { db } from './db.js';
import { search, type SearchUser } from './search.js';
import { dbSkipReason } from './test-fixtures.js';

const skip = await dbSkipReason();

// An org with no clients: only classifier codes can match.
const nobody: SearchUser = { orgId: 'no-such-org', clientIds: null };

describe('palette code search (database)', { skip }, () => {
  after(() => db.$disconnect());

  /** What Prisma's own startsWith + orderBy returns: the reference order. */
  const reference = async (prefix: string): Promise<string[]> =>
    (await db.mxikCode.findMany({ where: { code: { startsWith: prefix } }, orderBy: { code: 'asc' }, take: 5, select: { code: true } })).map((r) => r.code.trim());

  it('lists the first codes under a prefix in the classifier order, early and late in the key', async () => {
    const prefixes = await db.$queryRaw<{ prefix: string }[]>`
      (SELECT left(min(code), 5) AS prefix FROM mxik_code) UNION ALL (SELECT left(max(code), 5) FROM mxik_code)`;
    for (const { prefix } of prefixes) {
      const r = await search(nobody, prefix, 'uz');
      assert.ok(r.codes.length > 0, prefix);
      assert.ok(r.codes.every((c) => c.code.startsWith(prefix) && c.code.length === 17), prefix);
      assert.deepEqual(r.codes.map((c) => c.code), await reference(prefix), prefix);
    }
  });

  it('finds one exact code and nothing under a prefix no code has', async () => {
    const [first] = await reference('0');
    assert.ok(first);
    assert.deepEqual((await search(nobody, first, 'ru')).codes.map((c) => c.code), [first]);
    assert.deepEqual((await search(nobody, '99999', 'uz')).codes, []);
  });
});
