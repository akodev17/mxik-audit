import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { defaultClient } from './clients.js';
import { db } from '@tasnivo/db';
import { guessMapping } from './mapping-guess.js';
import { mergeSuggestion, resolveNamed, suggestMapping, toNamed } from './mapping-memory.js';
import { dbSkipReason, dropOrgs, makeOrg, type TestActor } from './test-fixtures.js';

const NONE = { barcode: -1, price: -1, sales: -1 };

describe('mapping memory by header name (pure)', () => {
  it('finds remembered columns by name wherever they moved', () => {
    const named = toNamed(['Nomi', 'Kod', 'Birlik'], { name: 0, mxik: 1, unit: 2, ...NONE });
    assert.deepEqual(named, { name: 'Nomi', mxik: 'Kod', unit: 'Birlik' });
    assert.deepEqual(resolveNamed(named, ['birlik', 'NOMI', 'Narx', 'Kod ']), { name: 1, mxik: 3, unit: 0 });
  });

  it('says "remembered" only for fields it actually took from memory', () => {
    const s = mergeSuggestion(['Birlik', 'Nomi', 'Narx'], [{ named: { name: 'Nomi', unit: 'Birlik', mxik: 'Kod' }, source: 'client' }]);
    assert.equal(s.remembered, 'client');
    assert.deepEqual([s.mapping.name, s.mapping.unit, s.mapping.mxik, s.mapping.price], [1, 0, -1, 2]);
    assert.equal(s.fields.name, 'remembered');
    assert.equal(s.fields.price, 'guess');
    assert.equal(s.fields.mxik, 'none');
  });

  it('falls through to the next memory, then to the header guess, never by position', () => {
    const memory = [
      { named: { name: 'Mahsulot' }, source: 'client' as const },
      { named: { name: 'Nomi' }, source: 'org' as const },
    ];
    assert.equal(mergeSuggestion(['Nomi', 'MXIK'], memory).remembered, 'org');
    const guessed = mergeSuggestion(['Tovar', 'MXIK kodi'], memory);
    assert.equal(guessed.remembered, null);
    assert.deepEqual(guessed.mapping, guessMapping(['Tovar', 'MXIK kodi']));
  });

  it('guesses codes before names, so "MXIK kodi" is never taken for the name', () => {
    const m = guessMapping(['Mahsulot MXIK kodi', 'Mahsulot nomi', 'Sotuv summasi', 'Narxi']);
    assert.deepEqual([m.mxik, m.name, m.sales, m.price], [0, 1, 2, 3]);
  });
});

const skip = await dbSkipReason();

describe('mapping memory (database)', { skip }, () => {
  let a: TestActor;
  before(async () => { a = await makeOrg(); });
  after(async () => {
    await dropOrgs([a.orgId]);
    await db.$disconnect();
  });

  it('uses the client’s last committed catalogue, then the org’s, and ignores previews', async () => {
    const first = await defaultClient(a.orgId);
    const second = await db.client.create({ data: { orgId: a.orgId, name: 'Ikkinchi' } });
    await db.catalog.create({
      data: { orgId: a.orgId, clientId: first.id, filename: 'a.xlsx', rowCount: 0, status: 'ready', headers: ['Nomi', 'Kod', 'Birlik'], columnMap: { name: 0, mxik: 1, unit: 2, ...NONE } },
    });
    // An uncommitted preview with other names must not count as a remembered mapping.
    await db.catalog.create({
      data: { orgId: a.orgId, clientId: second.id, filename: 'b.xlsx', rowCount: 0, status: 'uploaded', headers: ['X', 'Y'], columnMap: { name: 1, mxik: 0, unit: -1, ...NONE } },
    });

    const own = await suggestMapping(a.orgId, first.id, ['Birlik', 'Kod', 'Nomi']);
    assert.equal(own.remembered, 'client');
    assert.deepEqual([own.mapping.name, own.mapping.mxik, own.mapping.unit], [2, 1, 0]);

    const other = await suggestMapping(a.orgId, second.id, ['Kod', 'Nomi']);
    assert.equal(other.remembered, 'org');
    assert.deepEqual([other.mapping.name, other.mapping.mxik], [1, 0]);

    const unknown = await suggestMapping(a.orgId, second.id, ['Y', 'X']);
    assert.equal(unknown.remembered, null);
  });
});
