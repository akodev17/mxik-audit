import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { MxikCandidate, ScoredCandidate } from '../match/types.js';
import { MISMATCH_THRESHOLD, readCode, runChecks, summarize, type ResolvedRow } from './checks.js';

function candidate(code: string, overrides: Partial<MxikCandidate> = {}): MxikCandidate {
  return {
    code, nameUz: 'Shakar', nameRu: 'Сахар',
    groupName: 'SHAKAR', className: null, positionName: null, subPositionName: null,
    brandName: null, attributeName: null,
    subPositionCode: code.slice(0, 11),
    isBase: code.slice(11) === '000000',
    isMarked: false,
    unitBinding: 'none', unitCanonical: [], unitRaw: null, unitContainer: null, barcode: null,
    ...overrides,
  };
}

function scored(code: string, confidence: number, overrides: Partial<MxikCandidate> = {}): ScoredCandidate {
  return {
    candidate: candidate(code, overrides),
    signals: {}, ranks: {}, confidence,
    band: confidence >= 0.9 ? 'high' : confidence >= 0.6 ? 'medium' : 'low',
    reason: 'because', stage: 'fusion', adjustments: [],
    evidence: { stage: 'fusion', barcode: false, exactName: false, matchedWords: [], unit: 'none', rerankReason: null, rerankNone: false },
  };
}

const VALID = '01701001002000000';
/** Same 8-digit position as VALID. */
const OTHER = '01701001006000000';
/** A different position of the classifier altogether. */
const FOREIGN = '02202002001000000';

function row(overrides: Partial<ResolvedRow> = {}): ResolvedRow {
  return {
    existingMxik: VALID,
    unit: null,
    existing: { found: true, retired: false, candidate: candidate(VALID) },
    suggestions: [scored(VALID, 0.95)],
    ...overrides,
  };
}

describe('readCode', () => {
  it('strips whatever the spreadsheet decorated the code with', () => {
    assert.equal(readCode('0170 1001 002 000000'), '01701001002000000');
    assert.equal(readCode("'01701001002000000"), '01701001002000000');
  });

  it('treats blank and non-numeric cells as absent', () => {
    for (const v of [null, undefined, '', '   ', '-', 'n/a', 'yoʻq']) {
      assert.equal(readCode(v), null, `failed for ${JSON.stringify(v)}`);
    }
  });
});

describe('MISSING', () => {
  it('fires when the row has no code, and carries the suggestion', () => {
    const f = runChecks(row({ existingMxik: null, suggestions: [scored(VALID, 0.8)] }));
    assert.equal(f.length, 1);
    assert.equal(f[0]?.type, 'MISSING');
    assert.equal(f[0]?.severity, 'high');
    assert.equal(f[0]?.suggestedMxik, VALID);
  });

  it('still fires when nothing could be suggested', () => {
    const f = runChecks(row({ existingMxik: null, suggestions: [] }));
    assert.equal(f[0]?.type, 'MISSING');
    assert.equal(f[0]?.suggestedMxik, null);
    assert.equal(f[0]?.confidence, null);
  });

  it('excludes the other checks — a missing code cannot also mismatch', () => {
    const f = runChecks(row({ existingMxik: null, unit: 'litr' }));
    assert.equal(f.length, 1);
  });
});

describe('NOT_FOUND', () => {
  it('fires when the code is absent from the classifier', () => {
    const f = runChecks(row({
      existingMxik: '99999999999999999',
      existing: { found: false, retired: false, candidate: null },
    }));
    assert.equal(f.length, 1);
    assert.equal(f[0]?.type, 'NOT_FOUND');
    assert.equal(f[0]?.severity, 'high');
    assert.equal(f[0]?.wasRetired, false);
  });

  it('reports a retired code as NOT_FOUND but records that it was retired', () => {
    // ARCHIVED has no separate type yet; the fact is preserved for when it does.
    const f = runChecks(row({
      existing: { found: true, retired: true, candidate: candidate(VALID) },
    }));
    assert.equal(f[0]?.type, 'NOT_FOUND');
    assert.equal(f[0]?.wasRetired, true);
    assert.match(f[0]?.reason ?? '', /avvalgi versiyada/);
  });

  it('excludes the medium checks', () => {
    const f = runChecks(row({
      existingMxik: '99999999999999999',
      unit: 'litr',
      existing: { found: false, retired: false, candidate: null },
    }));
    assert.equal(f.length, 1);
  });
});

describe('MISMATCH', () => {
  it('fires when the row\'s own code scores below the threshold', () => {
    const f = runChecks(row({ suggestions: [scored(FOREIGN, 0.9), scored(VALID, 0.2)] }));
    assert.equal(f.length, 1);
    assert.equal(f[0]?.type, 'MISMATCH');
    assert.equal(f[0]?.severity, 'medium');
    assert.equal(f[0]?.suggestedMxik, FOREIGN);
  });

  it('fires when the row\'s code never surfaced in retrieval at all', () => {
    const f = runChecks(row({ suggestions: [scored(FOREIGN, 0.9)] }));
    assert.equal(f[0]?.type, 'MISMATCH');
  });

  it('fires when nothing was suggested at all', () => {
    const f = runChecks(row({ suggestions: [] }));
    assert.equal(f[0]?.type, 'MISMATCH');
  });

  it('does not fire when the best suggestion is in the same 8-digit position', () => {
    // A base code scored low against a branded name is still a defensible code.
    assert.deepEqual(runChecks(row({ suggestions: [scored(OTHER, 0.85), scored(VALID, 0.4)] })), []);
    assert.deepEqual(runChecks(row({ suggestions: [scored('01701001002003001', 0.85)] })), []);
  });

  it('does not fire when the row\'s own code is the best suggestion, however low', () => {
    assert.deepEqual(runChecks(row({ suggestions: [scored(VALID, 0.3)] })), []);
  });

  it('still fires for a code from another position of the same group', () => {
    const f = runChecks(row({ suggestions: [scored('01702001001000000', 0.9)] }));
    assert.equal(f[0]?.type, 'MISMATCH');
  });

  it('does not fire when the code scores at or above the threshold', () => {
    const f = runChecks(row({ suggestions: [scored(VALID, MISMATCH_THRESHOLD)] }));
    assert.deepEqual(f, []);
  });

  it('does not fire for a confident self-match', () => {
    assert.deepEqual(runChecks(row()), []);
  });
});

describe('UNIT_CONFLICT', () => {
  const strict = (units: string[]): Partial<MxikCandidate> =>
    ({ unitBinding: 'strict', unitCanonical: units });

  it('fires when the row unit contradicts a strict binding', () => {
    const f = runChecks(row({
      unit: 'litr',
      existing: { found: true, retired: false, candidate: candidate(VALID, strict(['dona'])) },
    }));
    assert.equal(f.length, 1);
    assert.equal(f[0]?.type, 'UNIT_CONFLICT');
    assert.equal(f[0]?.severity, 'medium');
    // The code is right; the unit is the thing to fix.
    assert.equal(f[0]?.suggestedMxik, VALID);
  });

  it('accepts the same unit written in another notation', () => {
    const f = runChecks(row({
      unit: 'кг',
      existing: { found: true, retired: false, candidate: candidate(VALID, strict(['kilogramm'])) },
    }));
    assert.deepEqual(f, []);
  });

  it('never fires for a recommended-only binding', () => {
    const f = runChecks(row({
      unit: 'litr',
      existing: {
        found: true, retired: false,
        candidate: candidate(VALID, { unitBinding: 'recommended', unitCanonical: ['dona'] }),
      },
    }));
    assert.deepEqual(f, []);
  });

  it('never fires when the row has no unit', () => {
    const f = runChecks(row({
      unit: null,
      existing: { found: true, retired: false, candidate: candidate(VALID, strict(['dona'])) },
    }));
    assert.deepEqual(f, []);
  });

  it('accepts any member of a multi-unit binding', () => {
    const f = runChecks(row({
      unit: 'tonna',
      existing: { found: true, retired: false, candidate: candidate(VALID, strict(['kilogramm', 'tonna'])) },
    }));
    assert.deepEqual(f, []);
  });

  it('can co-occur with MISMATCH on the same row', () => {
    const f = runChecks(row({
      unit: 'litr',
      existing: { found: true, retired: false, candidate: candidate(VALID, strict(['dona'])) },
      suggestions: [scored(FOREIGN, 0.9)],
    }));
    assert.deepEqual(f.map((x) => x.type).sort(), ['MISMATCH', 'UNIT_CONFLICT']);
  });
});

describe('summarize', () => {
  it('counts rows at risk, not findings', () => {
    // One row with two findings is one risky row.
    const s = summarize([
      [{ type: 'MISMATCH' }, { type: 'UNIT_CONFLICT' }],
      [{ type: 'MISSING' }],
      [],
    ] as never, 3);
    assert.equal(s.totalRows, 3);
    assert.equal(s.riskyRows, 2);
    assert.equal(s.byType.MISMATCH, 1);
    assert.equal(s.byType.UNIT_CONFLICT, 1);
    assert.equal(s.byType.MISSING, 1);
    assert.equal(s.byType.NOT_FOUND, 0);
  });

  it('handles a clean catalogue', () => {
    const s = summarize([[], [], []], 3);
    assert.equal(s.riskyRows, 0);
    assert.ok(Object.values(s.byType).every((n) => n === 0));
  });

  it('handles an empty catalogue without dividing by anything', () => {
    const s = summarize([], 0);
    assert.equal(s.totalRows, 0);
    assert.equal(s.riskyRows, 0);
  });
});
