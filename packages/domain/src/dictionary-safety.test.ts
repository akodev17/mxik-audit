// Integration (S4): the firm dictionary keeps product variants apart, a scoped accountant teaches it
// only unconfirmed entries, a replaced code is logged and held, a rejected or reported-wrong
// dictionary suggestion disputes its entry (auto-accept and "confirmed" leave it out, undo lifts
// it), and only admins edit or delete. Runs against the dev database; skips when it is not there.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { dictionaryKeys } from '@tasnivo/core/match/dictionary';
import { db } from '@tasnivo/db';
import { bulkApply } from './bulk.js';
import { recordDecision, recordGroupDecision, undoDecision } from './decisions.js';
import { confirmMapping, editMapping, learn, loadDictionary, removeMapping } from './dictionary.js';
import { acceptDictionaryMatches } from './dictionary-accept.js';
import { dictionaryWhere } from './dictionary-review.js';
import { makeClient, makePerson, type Person } from './firm-test-fixtures.js';
import { findingProvenance } from './finding-provenance.js';
import { recordWrongSuggestion } from './suggestion-feedback.js';
import { dbSkipReason, dropOrgs, liveCodes, makeOrg } from './test-fixtures.js';

const skip = await dbSkipReason();
const tag = (): string => randomBytes(3).toString('hex');

const evidence = (entryId?: string) => ({
  stage: 'dictionary', barcode: false, exactName: false, matchedWords: [], unit: 'none', rerankReason: null, rerankNone: false,
  dictionaryUses: 2, dictionaryConfirmations: 2, ...(entryId ? { dictionaryEntryId: entryId } : {}),
});

type Row = { rawName: string; suggestedMxik: string; entryId?: string; dictionary?: boolean };

/** One catalogue of the client; each row has one MISSING finding with its suggestion. */
async function catalogOf(orgId: string, clientId: string | null, rows: Row[]): Promise<{ catalogId: string; findingIds: string[] }> {
  const catalog = await db.catalog.create({
    data: { orgId, clientId, filename: `safety-${tag()}.xlsx`, rowCount: rows.length, status: 'ready', headers: ['name', 'unit'], columnMap: { name: 0, barcode: -1, mxik: -1, unit: 1, price: -1 } },
  });
  const findingIds: string[] = [];
  for (const [rowIndex, r] of rows.entries()) {
    const item = await db.catalogItem.create({ data: { catalogId: catalog.id, rowIndex, rawName: r.rawName, normalizedName: '', unit: 'kg', attrs: { original: [r.rawName] } } });
    const finding = await db.finding.create({
      data: {
        itemId: item.id, type: 'MISSING', severity: 'high', suggestedMxik: r.suggestedMxik, confidence: 0.96, alternatives: [], reason: 'test',
        ...(r.dictionary || r.entryId ? { evidence: evidence(r.entryId) } : {}),
      },
    });
    findingIds.push(finding.id);
  }
  return { catalogId: catalog.id, findingIds };
}

const entryOf = async (orgId: string, rawName: string) =>
  db.firmMapping.findUnique({ where: { orgId_kind_key: { orgId, kind: 'name', key: dictionaryKeys({ rawName, unit: 'kg' }).name ?? '' } } });

describe('dictionary safety (database)', { skip }, () => {
  let orgId = '';
  let admin: Person;
  let accountant: Person;
  let scoped: Person;
  let clientId = '';
  let codes: string[] = [];

  before(async () => {
    codes = await liveCodes(3);
    orgId = (await makeOrg()).orgId;
    clientId = await makeClient(orgId, 'Scoped client');
    admin = await makePerson(orgId, 'admin');
    accountant = await makePerson(orgId, 'accountant');
    scoped = await makePerson(orgId, 'accountant', [clientId]);
  });
  after(async () => {
    await dropOrgs([orgId]);
  });

  it('keeps variants with different sizes in separate entries, each found by its own row', async () => {
    const [x = '', y = ''] = codes;
    const t = [...randomBytes(5)].map((b) => String.fromCharCode(97 + (b % 26))).join(''); // letters only: digits read as a model code
    await learn(orgId, admin.userId, [{ rawName: `Sut ${t} 3.2% 1l`, unit: 'kg', barcode: null, code: x }], 'manual');
    await learn(orgId, admin.userId, [{ rawName: `Sut ${t} 2.5% 1l`, unit: 'kg', barcode: null, code: y }], 'manual');
    const fat = await entryOf(orgId, `Sut ${t} 3.2% 1l`);
    const lean = await entryOf(orgId, `Sut ${t} 2.5% 1l`);
    assert.equal(fat?.code, x);
    assert.equal(lean?.code, y);
    assert.notEqual(fat?.id, lean?.id);
    assert.equal(fat?.attrsKey, 'v1000;p3.2');
    const lookup = await loadDictionary(orgId);
    assert.equal(lookup.find(dictionaryKeys({ rawName: `sut ${t} 2,5 % 1 L`, unit: 'kg' }))?.code, y);
  });

  it('a scoped accountant\'s accept is kept unconfirmed until an unscoped member confirms it', async () => {
    const [x = ''] = codes;
    const name = `Scoped mahsulot ${tag()}`;
    const c = await catalogOf(orgId, clientId, [{ rawName: name, suggestedMxik: x }, { rawName: name, suggestedMxik: x }]);
    const decided = await recordDecision(scoped, { findingId: c.findingIds[0]!, decision: 'accepted' });
    assert.ok(decided.ok);
    let entry = await entryOf(orgId, name);
    assert.equal(entry?.code, x);
    assert.equal(entry?.confirmations, 0, 'a scoped decision is no confirmation');
    assert.equal(entry?.needsReconfirm, true);
    const event = await db.auditEvent.findUniqueOrThrow({ where: { id: decided.eventId } });
    const payload = event.payload as { scoped?: boolean; deciderEmail?: string };
    assert.equal(payload.scoped, true);
    assert.equal(payload.deciderEmail, scoped.email, 'the decider\'s e-mail outlives the account');

    // Auto-accept does not use it, even with the evidence claiming confirmations.
    const auto = await catalogOf(orgId, clientId, [{ rawName: name, suggestedMxik: x, entryId: entry.id }]);
    assert.equal((await acceptDictionaryMatches({ orgId, userId: admin.userId }, auto.catalogId, 'auto')).count, 0);

    assert.ok((await recordDecision(accountant, { findingId: c.findingIds[1]!, decision: 'accepted' })).ok);
    entry = await entryOf(orgId, name);
    assert.equal(entry?.confirmations, 1);
    assert.equal(entry?.needsReconfirm, false, 'an unscoped manual accept confirms it');

    // Undoing the scoped decision takes back its use but no confirmation it never gave.
    assert.ok((await undoDecision(scoped, decided.eventId)).ok);
    entry = await entryOf(orgId, name);
    assert.equal(entry?.confirmations, 1);
  });

  it('a replaced code is logged with the old one and needs a fresh confirmation when people had confirmed it', async () => {
    const [x = '', y = '', z = ''] = codes;
    const name = `Almashtirilgan ${tag()}`;
    await learn(orgId, admin.userId, [{ rawName: name, unit: 'kg', barcode: null, code: x }], 'manual');
    await learn(orgId, accountant.userId, [{ rawName: name, unit: 'kg', barcode: null, code: y }], 'manual');
    const entry = await entryOf(orgId, name);
    assert.equal(entry?.code, y);
    assert.equal(entry?.confirmations, 1);
    assert.equal(entry?.needsReconfirm, true, 'two people disagree: someone has to look again');
    const logged = await db.auditEvent.findFirstOrThrow({ where: { orgId, action: 'dictionary.code_replaced', targetId: entry.id } });
    const p = logged.payload as { previousCode: string; previousConfirmations: number; code: string };
    assert.deepEqual([p.previousCode, p.previousConfirmations, p.code], [x, 1, y]);

    // A bulk-only entry replaced by a person's decision is a plain correction.
    const other = `Ommaviy ${tag()}`;
    await learn(orgId, admin.userId, [{ rawName: other, unit: 'kg', barcode: null, code: x }], 'bulk');
    await learn(orgId, admin.userId, [{ rawName: other, unit: 'kg', barcode: null, code: z }], 'manual');
    const corrected = await entryOf(orgId, other);
    assert.equal(corrected?.needsReconfirm, false);
    assert.equal(corrected?.confirmations, 1);
  });

  it('rejecting a dictionary suggestion disputes its entry: no auto-accept, not "confirmed"; undo lifts it', async () => {
    const [x = ''] = codes;
    const name = `Rad etilgan ${tag()}`;
    await learn(orgId, admin.userId, [{ rawName: name, unit: 'kg', barcode: null, code: x }], 'manual');
    const entry = (await entryOf(orgId, name))!;
    const c = await catalogOf(orgId, null, [{ rawName: name, suggestedMxik: x, entryId: entry.id }, { rawName: name, suggestedMxik: x, entryId: entry.id }]);

    const rejected = await recordDecision(accountant, { findingId: c.findingIds[0]!, decision: 'rejected' });
    assert.ok(rejected.ok);
    let now = await db.firmMapping.findUniqueOrThrow({ where: { id: entry.id } });
    assert.ok(now.disputedAt, 'disputed');
    assert.equal(now.disputedBy, accountant.userId);
    assert.equal(await db.auditEvent.count({ where: { orgId, action: 'dictionary.disputed', targetId: entry.id } }), 1);
    const decision = (await db.auditEvent.findUniqueOrThrow({ where: { id: rejected.eventId } })).payload as { dictionaryDisputed?: string[] };
    assert.deepEqual(decision.dictionaryDisputed, [entry.id]);

    assert.equal((await acceptDictionaryMatches({ orgId, userId: admin.userId }, c.catalogId, 'auto')).count, 0, 'auto-accept skips a disputed entry');
    const inView = async (f: 'confirmed' | 'reconfirm') => db.firmMapping.count({ where: { AND: [dictionaryWhere(orgId, f, []), { id: entry.id }] } });
    assert.equal(await inView('confirmed'), 0);
    assert.equal(await inView('reconfirm'), 1);
    assert.equal((await loadDictionary(orgId)).find(dictionaryKeys({ rawName: name, unit: 'kg' }))?.hold, 'disputed');

    assert.ok((await undoDecision(accountant, rejected.eventId)).ok);
    now = await db.firmMapping.findUniqueOrThrow({ where: { id: entry.id } });
    assert.equal(now.disputedAt, null, 'undo takes the dispute back');
    assert.equal(await inView('confirmed'), 1);
    assert.equal((await acceptDictionaryMatches({ orgId, userId: admin.userId }, c.catalogId, 'auto')).count, 2);
  });

  it('a group reject and "suggestion wrong" dispute too; an old finding without an entry id is matched by its keys', async () => {
    const [x = ''] = codes;
    const name = `Guruh rad ${tag()}`;
    await learn(orgId, admin.userId, [{ rawName: name, unit: 'kg', barcode: null, code: x }], 'manual');
    const entry = (await entryOf(orgId, name))!;
    const c = await catalogOf(orgId, null, [{ rawName: name, suggestedMxik: x, entryId: entry.id }, { rawName: name, suggestedMxik: x, entryId: entry.id }]);
    const group = await recordGroupDecision(accountant, { findingIds: c.findingIds, decision: 'rejected' });
    assert.ok(group.ok && group.count === 2);
    assert.ok((await db.firmMapping.findUniqueOrThrow({ where: { id: entry.id } })).disputedAt);

    const other = `Notoʻgʻri ${tag()}`;
    await learn(orgId, admin.userId, [{ rawName: other, unit: 'kg', barcode: null, code: x }], 'manual');
    const legacy = await catalogOf(orgId, null, [{ rawName: other, suggestedMxik: x, dictionary: true }]);
    assert.equal(await recordWrongSuggestion(accountant, { findingId: legacy.findingIds[0]!, reason: 'other_category' }), true);
    const disputed = (await entryOf(orgId, other))!;
    assert.equal(disputed.disputedBy, accountant.userId);
    const logged = await db.auditEvent.findFirstOrThrow({ where: { orgId, action: 'dictionary.disputed', targetId: disputed.id } });
    assert.equal((logged.payload as { via: string }).via, 'wrong_suggestion');
  });

  it('a reject from the bulk bar disputes only the own org\'s entries behind dictionary suggestions; undo lifts it', async () => {
    const [x = ''] = codes;
    const name = `Ommaviy rad ${tag()}`;
    const plain = `Oddiy ${tag()}`;
    await learn(orgId, admin.userId, [{ rawName: name, unit: 'kg', barcode: null, code: x }, { rawName: plain, unit: 'kg', barcode: null, code: x }], 'manual');
    const entry = (await entryOf(orgId, name))!;
    const plainEntry = (await entryOf(orgId, plain))!;
    const foreignOrg = (await makeOrg()).orgId;
    try {
      const foreignName = `Begona ${tag()}`;
      await learn(foreignOrg, (await makePerson(foreignOrg, 'admin')).userId, [{ rawName: foreignName, unit: 'kg', barcode: null, code: x }], 'manual');
      const foreign = (await entryOf(foreignOrg, foreignName))!;
      const c = await catalogOf(orgId, null, [
        { rawName: name, suggestedMxik: x, entryId: entry.id },
        { rawName: name, suggestedMxik: x, entryId: entry.id },
        // Same name as an entry, but the suggestion did not come from the dictionary.
        { rawName: plain, suggestedMxik: x },
        // Evidence naming another org's entry is never followed.
        { rawName: foreignName, suggestedMxik: x, entryId: foreign.id },
      ]);

      const done = await bulkApply(accountant, c.catalogId, { ids: c.findingIds }, { kind: 'reject' });
      assert.ok(done.ok && done.count === 4 && done.eventId);
      const now = await db.firmMapping.findUniqueOrThrow({ where: { id: entry.id } });
      assert.ok(now.disputedAt, 'disputed');
      assert.equal(now.disputedBy, accountant.userId);
      assert.equal((await db.firmMapping.findUniqueOrThrow({ where: { id: plainEntry.id } })).disputedAt, null, 'not a dictionary suggestion');
      assert.equal((await db.firmMapping.findUniqueOrThrow({ where: { id: foreign.id } })).disputedAt, null, 'another org\'s entry');
      assert.equal(await db.auditEvent.count({ where: { orgId, action: 'dictionary.disputed', targetId: entry.id } }), 1);
      const event = await db.auditEvent.findUniqueOrThrow({ where: { id: done.eventId } });
      assert.equal(event.action, 'finding.bulk_rejected');
      assert.deepEqual((event.payload as { dictionaryDisputed?: string[] }).dictionaryDisputed, [entry.id]);

      const later = await catalogOf(orgId, null, [{ rawName: name, suggestedMxik: x, entryId: entry.id }]);
      assert.equal((await acceptDictionaryMatches({ orgId, userId: admin.userId }, later.catalogId, 'auto')).count, 0, 'auto-accept skips a disputed entry');
      assert.ok((await undoDecision(accountant, done.eventId)).ok);
      assert.equal((await db.firmMapping.findUniqueOrThrow({ where: { id: entry.id } })).disputedAt, null, 'undo takes the dispute back');
      assert.equal((await acceptDictionaryMatches({ orgId, userId: admin.userId }, later.catalogId, 'auto')).count, 1);
    } finally {
      await dropOrgs([foreignOrg]);
    }
  });

  it('confirming: any unscoped writer lifts needsReconfirm; a dispute only an admin; edits and deletes are admin-only', async () => {
    const [x = '', y = ''] = codes;
    const name = `Tasdiq ${tag()}`;
    await learn(orgId, scoped.userId, [{ rawName: name, unit: 'kg', barcode: null, code: x }], 'manual');
    const id = (await entryOf(orgId, name))!.id;

    assert.deepEqual(await confirmMapping(scoped, id), { ok: false, code: 'forbidden' }, 'the dictionary is not a scoped member\'s');
    assert.deepEqual(await confirmMapping(accountant, id), { ok: true });
    let entry = await db.firmMapping.findUniqueOrThrow({ where: { id } });
    assert.deepEqual([entry.confirmations, entry.needsReconfirm, entry.source], [1, false, 'confirm']);

    await db.firmMapping.update({ where: { id }, data: { disputedAt: new Date(), disputedBy: accountant.userId } });
    assert.deepEqual(await confirmMapping(accountant, id), { ok: false, code: 'forbidden' });
    assert.deepEqual(await confirmMapping(admin, id), { ok: true });
    entry = await db.firmMapping.findUniqueOrThrow({ where: { id } });
    assert.equal(entry.disputedAt, null);

    assert.deepEqual(await editMapping(accountant, id, y), { ok: false, code: 'forbidden' });
    assert.deepEqual(await removeMapping(accountant, id), { ok: false, code: 'forbidden' });
    assert.deepEqual(await editMapping(admin, id, y), { ok: true });
    entry = await db.firmMapping.findUniqueOrThrow({ where: { id } });
    assert.deepEqual([entry.code, entry.confirmations, entry.needsReconfirm], [y, 0, true], 'an edit is not trusted until confirmed');
    assert.deepEqual(await editMapping(admin, id, x, true), { ok: true });
    entry = await db.firmMapping.findUniqueOrThrow({ where: { id } });
    assert.deepEqual([entry.code, entry.confirmations, entry.needsReconfirm], [x, 1, false], '"confirm now" vouches for it');
    assert.deepEqual(await removeMapping(admin, id), { ok: true });
  });

  it('the drawer\'s provenance names the entry for unscoped members, nothing for scoped ones', async () => {
    const [x = ''] = codes;
    const name = `Manba ${tag()}`;
    await learn(orgId, admin.userId, [{ rawName: name, unit: 'kg', barcode: null, code: x }], 'manual');
    const entry = (await entryOf(orgId, name))!;
    const c = await catalogOf(orgId, clientId, [{ rawName: name, suggestedMxik: x, entryId: entry.id }]);
    const seen = await findingProvenance(accountant, c.findingIds[0]!);
    assert.equal(seen?.dictionary?.entryId, entry.id);
    assert.equal(seen?.dictionary?.label, name);
    assert.equal(seen?.dictionary?.createdBy, admin.email);
    assert.equal(seen?.carriedFrom, null);
    const narrow = await findingProvenance(scoped, c.findingIds[0]!);
    assert.equal(narrow?.dictionary, null, 'its product names come from every client');
    const stranger = await makeOrg();
    try {
      assert.equal(await findingProvenance({ orgId: stranger.orgId, clientIds: null }, c.findingIds[0]!), null);
    } finally {
      await dropOrgs([stranger.orgId]);
    }
  });
});
