import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FindingType } from '@prisma/client';
import { fillFindingTypes, findingsAt, isUnknownFindingType, withoutFindingType } from './finding-type-extension.js';
import { mergeTypeCounts, readFindingType } from './finding-type.js';

describe('readFindingType', () => {
  it('keeps every value the generated client knows', () => {
    for (const type of Object.values(FindingType)) assert.equal(readFindingType(type), type);
  });

  it('turns an unknown, empty or missing value into OTHER, never throwing', () => {
    assert.equal(readFindingType('FUTURE_CHECK'), 'OTHER');
    assert.equal(readFindingType('missing'), 'OTHER');
    assert.equal(readFindingType(''), 'OTHER');
    assert.equal(readFindingType(null), 'OTHER');
    assert.equal(readFindingType(undefined), 'OTHER');
  });

  it('merges every unknown value of a count into one OTHER entry', () => {
    const merged = mergeTypeCounts([{ type: 'MISSING', count: 3 }, { type: 'FUTURE_A', count: 2 }, { type: 'FUTURE_B', count: 4 }]);
    assert.deepEqual(merged, [{ type: 'MISSING', count: 3 }, { type: 'OTHER', count: 6 }]);
  });
});

describe('finding-type fallback: rewriting a read', () => {
  it('omits type on a finding read without select, and finds the records at the root', () => {
    const { args, needs } = withoutFindingType('Finding', { where: { id: 'x' } });
    assert.deepEqual(args, { where: { id: 'x' }, omit: { type: true, id: false } });
    assert.deepEqual(needs, [{ path: [], dropId: false }]);
  });

  it('drops type from a select, adding the id only for the fill', () => {
    const { args, needs } = withoutFindingType('Finding', { select: { type: true, decision: true } });
    assert.deepEqual(args, { select: { decision: true, id: true } });
    assert.deepEqual(needs, [{ path: [], dropId: true }]);
    const kept = withoutFindingType('Finding', { select: { id: true, type: true } });
    assert.deepEqual(kept.needs, [{ path: [], dropId: false }]);
  });

  it('leaves a read that never returns the type alone', () => {
    assert.deepEqual(withoutFindingType('Finding', { select: { id: true, severity: true } }).needs, []);
    assert.deepEqual(withoutFindingType('Finding', { omit: { type: true } }).needs, []);
    assert.deepEqual(withoutFindingType('Catalog', { select: { id: true, _count: { select: { items: true } } } }).needs, []);
  });

  it('follows relations to findings at any depth, `true` included', () => {
    const input = {
      where: { catalogId: 'c' },
      include: { findings: true, catalog: { select: { id: true } } },
    };
    const { args, needs } = withoutFindingType('CatalogItem', input);
    assert.deepEqual(args, { where: { catalogId: 'c' }, include: { findings: { omit: { type: true, id: false } }, catalog: { select: { id: true } } } });
    assert.deepEqual(needs, [{ path: ['findings'], dropId: false }]);
    assert.deepEqual(input.include.findings, true, 'the caller’s args are not changed');

    const deep = withoutFindingType('Catalog', { select: { items: { select: { findings: { select: { type: true } } } } } });
    assert.deepEqual(deep.args, { select: { items: { select: { findings: { select: { id: true } } } } } });
    assert.deepEqual(deep.needs, [{ path: ['items', 'findings'], dropId: true }]);
  });

  it('collects the records at a path through lists and nulls', () => {
    const result = [{ findings: [{ id: 'a' }, { id: 'b' }] }, { findings: [] }, { findings: null }];
    assert.deepEqual(findingsAt(result, ['findings']).map((r) => r['id']), ['a', 'b']);
    assert.deepEqual(findingsAt(null, []), []);
  });

  it('fills the type from the text read: known as is, unknown or unseen as OTHER', async () => {
    const result = [{ id: 'a', decision: 'pending' }, { id: 'b', decision: 'pending' }, { id: 'c', decision: 'pending' }];
    let asked: string[] = [];
    await fillFindingTypes(result, [{ path: [], dropId: true }], (ids) => {
      asked = ids;
      return Promise.resolve(new Map([['a', 'MISSING'], ['b', 'FUTURE_CHECK']]));
    });
    assert.deepEqual(asked, ['a', 'b', 'c']);
    assert.deepEqual(result, [{ decision: 'pending', type: 'MISSING' }, { decision: 'pending', type: 'OTHER' }, { decision: 'pending', type: 'OTHER' }]);
  });

  it('recognises only Prisma’s unknown-enum error for FindingType', () => {
    assert.equal(isUnknownFindingType(new Error("Invalid `db.finding.findMany()` invocation:\n\nValue 'RESTRICTED' not found in enum 'FindingType'")), true);
    assert.equal(isUnknownFindingType(new Error("Value 'x' not found in enum 'Severity'")), false);
    assert.equal(isUnknownFindingType('not an error'), false);
  });
});
