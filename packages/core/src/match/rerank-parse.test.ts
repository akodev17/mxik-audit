import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { NONE_REASON, parseJson, rowVerdicts, splitBatch } from './rerank-parse.js';

const OFFERED = ['01901001003000000', '01901001003002001'];

describe('rowVerdicts', () => {
  it('keeps codes that were offered for the row', () => {
    const r = rowVerdicts({
      id: 'r1', none: false,
      ranking: [{ code: '01901001003002001', confidence: 0.9, reason: 'brand named' }],
    }, OFFERED);
    assert.deepEqual(r?.verdicts.map((v) => v.code), ['01901001003002001']);
    assert.equal(r?.discarded, 0);
  });

  it('rejects a code that was not among the candidates', () => {
    const r = rowVerdicts({
      id: 'r1', none: false,
      ranking: [
        { code: '09999999999999999', confidence: 0.99, reason: 'invented' },
        { code: '01901001003000000', confidence: 0.5, reason: 'base' },
      ],
    }, OFFERED);
    assert.deepEqual(r?.verdicts.map((v) => v.code), ['01901001003000000']);
    assert.equal(r?.discarded, 1);
  });

  it('rejects malformed codes and duplicates', () => {
    const r = rowVerdicts({
      id: 'r1', none: false,
      ranking: [
        { code: '0190100100300000', confidence: 0.9, reason: '16 digits' },
        { code: '01901001003000000', confidence: 0.8, reason: 'ok' },
        { code: '01901001003000000', confidence: 0.7, reason: 'dupe' },
      ],
    }, OFFERED);
    assert.equal(r?.verdicts.length, 1);
    assert.equal(r?.discarded, 2);
  });

  it('returns null when every returned code is invalid', () => {
    const r = rowVerdicts({
      id: 'r1', none: false,
      ranking: [{ code: '09999999999999999', confidence: 0.99, reason: 'invented' }],
    }, OFFERED);
    assert.equal(r, null);
  });

  it('turns "none" into a zero score for every offered code', () => {
    const r = rowVerdicts({ id: 'r1', none: true, ranking: [] }, OFFERED);
    assert.deepEqual(r?.verdicts.map((v) => [v.code, v.confidence]), OFFERED.map((c) => [c, 0]));
    assert.equal(r?.verdicts[0]?.reason, NONE_REASON);
  });

  it('rejects out-of-range confidence and wrong shapes', () => {
    assert.equal(rowVerdicts({ id: 'r1', none: false, ranking: [{ code: OFFERED[0], confidence: 1.5, reason: 'x' }] }, OFFERED), null);
    assert.equal(rowVerdicts({ id: 'r1', ranking: [] }, OFFERED), null);
    assert.equal(rowVerdicts('not an object', OFFERED), null);
  });
});

describe('splitBatch', () => {
  it('maps rows by id and ignores ids that were never asked for', () => {
    const rows = splitBatch({ rows: [{ id: 'r1' }, { id: 'r9' }, { id: 'r2' }] }, ['r1', 'r2']);
    assert.deepEqual([...rows.keys()], ['r1', 'r2']);
  });

  it('returns nothing for a malformed envelope', () => {
    assert.equal(splitBatch({ ranking: [] }, ['r1']).size, 0);
    assert.equal(splitBatch(undefined, ['r1']).size, 0);
  });
});

describe('parseJson', () => {
  it('never throws', () => {
    assert.equal(parseJson('{"rows": ['), undefined);
    assert.deepEqual(parseJson('{"rows": []}'), { rows: [] });
  });
});
