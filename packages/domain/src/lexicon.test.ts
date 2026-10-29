// The learned lexicon against the database: alias aggregation (two orgs vs one, bulk accepts
// ignored, decisions), the merged loading of active entries, and the admin saves with the
// normaliser's check. Skipped without a database.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { applySynonyms } from '@tasnivo/core/normalize/synonyms';
import { EMPTY_LEXICON, installLexicon } from '@tasnivo/core/normalize/lexicon';
import { normalizeName } from '@tasnivo/core/normalize/index';
import { resolveUnit } from '@tasnivo/core/normalize/units';
import { db } from '@tasnivo/db';
import { learn } from './dictionary.js';
import {
  aliasCandidates, aliasKey, applyLexicon, createEntry, decideAlias, entryKeyOf, forgetLexicon, loadLexicon, updateEntry,
} from './lexicon.js';
import { dbSkipReason, dropOrgs, liveCodes, makeOrg, type TestActor } from './test-fixtures.js';

const skip = await dbSkipReason();

/** Names no other test or real catalogue uses, so the aggregation is this test's alone. */
const NAME = 'Zz-test shisha tolali mato 7731';
const LONE = 'Zz-test yolgiz nom 7731';
const key = aliasKey(NAME);

describe('learned lexicon (database)', { skip }, () => {
  const orgs: string[] = [];
  let a: TestActor;
  let b: TestActor;
  let c: TestActor;
  let codes: string[];
  const entryIds: string[] = [];
  const admin = () => ({ userId: a.userId, orgId: a.orgId });

  before(async () => {
    [a, b, c] = await Promise.all([makeOrg('internal'), makeOrg('internal'), makeOrg('internal')]);
    orgs.push(a.orgId, b.orgId, c.orgId);
    codes = await liveCodes(2);
    await db.lexiconEntry.deleteMany({ where: { key: { contains: 'zz-test' } } });
    await db.lexiconEntry.deleteMany({ where: { key: { contains: key } } });
  });
  after(async () => {
    installLexicon(EMPTY_LEXICON);
    forgetLexicon();
    await db.lexiconEntry.deleteMany({ where: { OR: [{ id: { in: entryIds } }, { key: { contains: 'zz-test' } }, { key: { contains: key } }] } });
    await dropOrgs(orgs);
  });

  it('counts a confirmation per org, name and code; bulk accepts never count', async () => {
    const item = (code: string, rawName = NAME) => [{ rawName, unit: 'dona', barcode: null, code }];
    await learn(a.orgId, a.userId, item(codes[0]!), 'manual');
    await learn(a.orgId, a.userId, item(codes[0]!), 'manual'); // the same org again: one org, two confirmations
    await learn(a.orgId, a.userId, item(codes[0]!, LONE), 'manual');
    await learn(c.orgId, c.userId, item(codes[0]!), 'bulk');
    await learn(c.orgId, c.userId, item(codes[0]!), 'bulk_sure');
    await learn(c.orgId, c.userId, item(codes[0]!), 'dictionary');
    const mine = (await aliasCandidates()).filter((x) => x.key === key || x.key === aliasKey(LONE));
    assert.deepEqual(mine, [], 'one organisation is no candidate, and the bulk org does not count');
    const rows = await db.learnedAlias.findMany({ where: { key }, orderBy: { orgId: 'asc' } });
    assert.deepEqual(rows.map((r) => [r.orgId, r.code, r.confirmations]), [[a.orgId, codes[0], 2]]);
  });

  it('a second org with a group decision makes the pair a candidate, with examples and the live count', async () => {
    await learn(b.orgId, b.userId, [{ rawName: NAME.toUpperCase(), unit: null, barcode: null, code: codes[0]! }], 'group');
    const candidates = (await aliasCandidates()).filter((x) => x.key === key);
    assert.equal(candidates.length, 1);
    const [cand] = candidates;
    assert.equal(cand?.code, codes[0]);
    assert.equal(cand?.orgs, 2);
    assert.equal(cand?.confirmations, 3);
    assert.equal(cand?.status, 'candidate');
    assert.equal(cand?.entryId, null);
    assert.ok(cand?.examples.includes(normalizeName(NAME).display));
    assert.equal(typeof cand?.codeName, 'string');
    // A second code for the same name is its own pair, and alone it is no candidate.
    await learn(c.orgId, c.userId, [{ rawName: NAME, unit: null, barcode: null, code: codes[1]! }], 'manual');
    assert.deepEqual((await aliasCandidates()).filter((x) => x.key === key).map((x) => x.code), [codes[0]]);
  });

  it('nothing is active until an admin approves; a rejected candidate stays listed as rejected', async () => {
    assert.equal((await loadLexicon()).aliases.find(key).length, 0);
    const notYet = await decideAlias(admin(), { key: aliasKey(LONE), code: codes[0]!, decision: 'approve' });
    assert.equal(notYet.ok, false, 'one organisation is not a candidate');
    const rejected = await decideAlias(admin(), { key, code: codes[0]!, decision: 'reject' });
    assert.ok(rejected.ok);
    if (rejected.ok) entryIds.push(rejected.id);
    assert.equal((await aliasCandidates()).find((x) => x.key === key)?.status, 'rejected');
    assert.equal((await loadLexicon()).aliases.find(key).length, 0);

    const approved = await decideAlias(admin(), { key, code: codes[0]!, decision: 'approve' });
    assert.ok(approved.ok);
    const loaded = await loadLexicon();
    assert.deepEqual(loaded.aliases.find(key), [{ code: codes[0], orgs: 2, confirmations: 3 }]);
    assert.equal((await aliasCandidates()).find((x) => x.key === key)?.status, 'active');
    assert.equal(loaded.counts.aliases >= 1, true);

    // A disabled entry is out of the lookup, whatever the aggregation says.
    await db.lexiconEntry.updateMany({ where: { kind: 'alias', key: `${key}|${codes[0]}` }, data: { status: 'disabled' } });
    assert.equal((await loadLexicon()).aliases.find(key).length, 0);
    assert.equal((await aliasCandidates()).find((x) => x.key === key)?.status, 'disabled');
  });

  it('synonym and unit entries are merged with the file tables when active, and checked on every save', async () => {
    const synonym = { forms: ['zz-test-steklovata', 'zz-test стекловата'], term: 'стеклянная вата' };
    const created = await createEntry(admin(), { kind: 'synonym', payload: synonym, note: 'test' });
    assert.ok(created.ok, JSON.stringify(created));
    if (created.ok) entryIds.push(created.id);
    const twice = await createEntry(admin(), { kind: 'synonym', payload: synonym });
    assert.deepEqual(twice, { ok: false, problems: ['duplicate'] });
    const breaking = await createEntry(admin(), { kind: 'synonym', payload: { forms: ['лист'], term: 'прокат листовой', replace: true } });
    assert.equal(breaking.ok, false);
    assert.ok(!breaking.ok && breaking.problems.some((p) => p.startsWith('a name without a synonym is unchanged')));
    const badUnit = await createEntry(admin(), { kind: 'unit', payload: { alias: 'zz-qop', target: 'no such unit' } });
    assert.equal(badUnit.ok, false);
    const unit = await createEntry(admin(), { kind: 'unit', payload: { alias: 'zz-qop', target: 'dona' } });
    assert.ok(unit.ok, JSON.stringify(unit));
    if (unit.ok) entryIds.push(unit.id);

    const loaded = await loadLexicon();
    assert.ok(loaded.lexicon.synonyms.some((s) => s.forms[0] === 'zz-test-steklovata'));
    assert.ok(loaded.lexicon.unitAliases.some((u) => u.alias === 'zz-qop'));

    // applyLexicon installs: the normaliser now reads the entries; forgetting and disabling takes them back.
    await applyLexicon({ fresh: true });
    assert.deepEqual(applySynonyms(normalizeName('zz-test-steklovata 50mm').queryKey).applied, ['zz-test-steklovata → стеклянная вата']);
    assert.equal(resolveUnit('zz-qop')?.id, 1);
    const disabled = await updateEntry(admin(), created.ok ? created.id : '', { status: 'disabled' });
    assert.ok(disabled.ok);
    await applyLexicon({ fresh: true });
    assert.deepEqual(applySynonyms(normalizeName('zz-test-steklovata 50mm').queryKey).applied, []);
    assert.equal(resolveUnit('zz-qop')?.id, 1, 'the unit alias is still active');

    // An edit is checked like a new entry, and re-enabling one too.
    const badEdit = await updateEntry(admin(), unit.ok ? unit.id : '', { payload: { alias: 'kg', target: 'gramm' } });
    assert.equal(badEdit.ok, false);
    const reEnabled = await updateEntry(admin(), created.ok ? created.id : '', { status: 'active', note: null });
    assert.ok(reEnabled.ok);
    assert.equal(entryKeyOf('synonym', synonym), 'zz test steklovata|zz test steklovata');
    assert.deepEqual(await updateEntry(admin(), 'no-such-id', { status: 'disabled' }), { ok: false, notFound: true });
  });
});
