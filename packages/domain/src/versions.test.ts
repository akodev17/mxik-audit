import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { db } from '@tasnivo/db';
import { makeClient } from './firm-test-fixtures.js';
import { storeDocList } from './docs.js';
import { storePurchaseList } from './purchases.js';
import { parseUpload } from './spreadsheet.js';
import { dbSkipReason, dropOrgs, liveCodes, makeOrg, type TestActor } from './test-fixtures.js';
import { findingProvenance } from './finding-provenance.js';
import { carryOver, compareCandidates, linkPrevious, versionDiff } from './versions.js';

const skip = await dbSkipReason();

describe('catalogue versions (database)', { skip }, () => {
  let a: TestActor;
  let clientId = '';
  let minute = 0;

  // Each catalogue a minute after the last, so "earlier" is unambiguous.
  const catalog = async (status: 'ready' | 'analyzing', names: string[], previousId: string | null = null): Promise<string> => {
    const made = await db.catalog.create({
      data: {
        orgId: a.orgId, clientId, previousId, filename: `v${minute}.xlsx`, rowCount: names.length, status,
        createdAt: new Date(Date.UTC(2026, 9, 16, 13, minute++)),
        headers: ['Nomi'], columnMap: { name: 0, barcode: -1, mxik: -1, unit: -1, price: -1, sales: -1 },
      },
    });
    // Stored last row first: the database's own order must not leak into the lists.
    await db.catalogItem.createMany({
      data: names.map((rawName, rowIndex) => ({ catalogId: made.id, rowIndex, rawName, normalizedName: rawName.toLowerCase(), attrs: { original: [rawName] } })).reverse(),
    });
    return made.id;
  };
  const previousOf = async (id: string) => (await db.catalog.findUniqueOrThrow({ where: { id }, select: { previousId: true } })).previousId;

  before(async () => {
    a = await makeOrg();
    clientId = await makeClient(a.orgId, 'versions-client');
  });
  after(async () => {
    await dropOrgs([a.orgId]);
  });

  it('links a re-upload to the earlier upload once that one is ready, even if it was still audited at the start', async () => {
    const first = await catalog('analyzing', ['Guruch', 'Shakar']);
    const second = await catalog('analyzing', ['Guruch', 'Shakar']);
    await linkPrevious(second);
    assert.equal(await previousOf(second), null, 'nothing ready to link to yet');
    await db.catalog.update({ where: { id: first }, data: { status: 'ready' } });
    await carryOver(second, null);
    assert.equal(await previousOf(second), first, 'linked before decisions carry over');
  });

  it('a carried-over decision keeps the upload and the moment it was first made, across two carry-overs', async () => {
    const [code = ''] = await liveCodes(1);
    const decider = (await db.user.create({ data: { orgId: a.orgId, email: `carry-${Date.now()}@test.local`, passwordHash: 'x' } })).id;
    const finding = async (catalogId: string, decided: Date | null) => {
      const [item] = await db.catalogItem.findMany({ where: { catalogId }, orderBy: { rowIndex: 'asc' }, take: 1 });
      return (await db.finding.create({
        data: {
          itemId: item!.id, type: 'MISSING', severity: 'high', suggestedMxik: code, confidence: 0.9, alternatives: [], reason: 'test',
          ...(decided ? { decision: 'accepted', chosenMxik: code, decidedBy: decider, decidedAt: decided, decisionSource: 'manual' } : {}),
        },
      })).id;
    };
    const first = await catalog('ready', ['Sabzi']);
    const decidedAt = new Date(Date.UTC(2026, 8, 1, 9, 30));
    await finding(first, decidedAt);
    const second = await catalog('ready', ['Sabzi'], first);
    const inSecond = await finding(second, null);
    assert.equal(await carryOver(second, null), 1);
    const once = await db.finding.findUniqueOrThrow({ where: { id: inSecond } });
    assert.equal(once.carriedFromCatalogId, first);
    assert.equal(once.originalDecidedAt?.toISOString(), decidedAt.toISOString());
    assert.notEqual(once.decidedAt?.toISOString(), decidedAt.toISOString(), 'decidedAt is the carry-over time');

    const third = await catalog('ready', ['Sabzi'], second);
    const inThird = await finding(third, null);
    assert.equal(await carryOver(third, null), 1);
    const twice = await db.finding.findUniqueOrThrow({ where: { id: inThird } });
    assert.equal(twice.carriedFromCatalogId, first, 'still the upload it was first made in');
    assert.equal(twice.originalDecidedAt?.toISOString(), decidedAt.toISOString());
    assert.equal(twice.decidedBy, decider);

    const shown = await findingProvenance({ orgId: a.orgId, clientIds: null }, inThird);
    assert.deepEqual(shown?.carriedFrom, { catalogId: first, filename: (await db.catalog.findUniqueOrThrow({ where: { id: first } })).filename, originalDecidedAt: decidedAt });
    await db.catalog.delete({ where: { id: first } });
    assert.equal((await findingProvenance({ orgId: a.orgId, clientIds: null }, inThird))?.carriedFrom?.filename, null, 'a deleted upload is named as such');
  });

  it('lists added and removed rows in file order', async () => {
    const prev = await catalog('ready', ['Olma', 'Guruch', 'Nok', 'Shakar', 'Tuz', 'Un']);
    const next = await catalog('ready', ['Choy', 'Guruch', 'Qahva', 'Shakar', 'Asal'], prev);
    const diff = await versionDiff(a.orgId, next);
    assert.ok(diff);
    assert.equal(diff.linked, true);
    assert.deepEqual(diff.removed.map((r) => r.name), ['Olma', 'Nok', 'Tuz', 'Un']);
    assert.deepEqual(diff.added.map((r) => r.name), ['Choy', 'Qahva', 'Asal']);
  });

  it('compares a catalogue without a link with an earlier ready catalogue of the client, carrying nothing', async () => {
    const lone = await catalog('ready', ['Guruch', 'Tuz']);
    assert.equal(await versionDiff(a.orgId, lone), null);
    const candidates = await compareCandidates(a.orgId, lone);
    assert.ok(candidates.length > 0 && candidates.every((c) => c.id !== lone));
    assert.deepEqual(await compareCandidates(a.orgId, candidates.at(-1)?.id ?? ''), [], 'the first catalogue has nothing earlier');
    assert.equal(await versionDiff(a.orgId, candidates[0]?.id ?? '', lone), null, 'never against a later upload');
    const other = candidates[0]?.id ?? '';
    const chosen = await versionDiff(a.orgId, lone, other);
    assert.ok(chosen);
    assert.equal(chosen.linked, false);
    assert.equal(chosen.counts.carried, 0);
    assert.equal(await versionDiff('another-org', lone, other), null);
    assert.equal(await versionDiff(a.orgId, lone, lone), null, 'not with itself');
  });

  it('an archived client takes no new purchase, cheque or sales list', async () => {
    const archived = await makeClient(a.orgId, 'versions-archived', { archived: true });
    const parsed = await parseUpload(Buffer.from('Tovar,MXIK\nGuruch,06301001001000000\n'), 'kirim.csv');
    const actor = { orgId: a.orgId, userId: a.userId, clientIds: null };
    assert.equal((await storePurchaseList(actor, { clientId: archived, filename: 'k.csv', parsed })).ok, false);
    assert.equal(await storeDocList(actor, { clientId: archived, kind: 'sales', filename: 's.csv', parsed }), null);
    assert.equal(await db.purchaseList.count({ where: { clientId: archived } }), 0);
  });
});
