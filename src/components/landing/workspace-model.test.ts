import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SAMPLE_FILENAME as SCRIPT_FILENAME } from '../../../scripts/landing-sample/catalog.js';
import { SAMPLE_REPORT } from '../../lib/sample-report.generated.js';
import { SAMPLE_FILENAME } from './data.js';
import { firstDivergence, splitCode } from './mxik-code.js';
import {
  FILTERS, bandOf, countsFor, primaryFinding, readFinding, rowsFor, sentenceCase,
} from './workspace-model.js';

const { catalog, codes, byType, riskyRows, totalRows } = SAMPLE_REPORT;

describe('workspace filters', () => {
  const counts = countsFor(catalog);

  it('agree with the frozen totals the page states elsewhere', () => {
    assert.equal(counts.all, totalRows);
    assert.equal(counts.risky, riskyRows);
    assert.equal(counts.clean, totalRows - riskyRows);
    for (const t of ['MISSING', 'NOT_FOUND', 'MISMATCH', 'UNIT_CONFLICT'] as const) {
      // A row is counted once per type even if it carries several findings.
      assert.equal(counts[t], byType[t], t);
    }
  });

  it('return exactly the rows each tab counts', () => {
    for (const f of FILTERS) assert.equal(rowsFor(catalog, f.key).length, counts[f.key], f.key);
  });

  it('list each row under its most severe finding', () => {
    const row = { row: 2, name: 'x', barcode: null, unit: null, code: null, findings: [
      { type: 'UNIT_CONFLICT' as const, suggestedMxik: null, confidence: null, requiredUnit: 'dona', reason: '' },
      { type: 'MISMATCH' as const, suggestedMxik: null, confidence: 0.5, requiredUnit: null, reason: '' },
    ] };
    assert.equal(primaryFinding(row)?.type, 'MISMATCH');
  });
});

describe('row reading', () => {
  it('explains every finding in the sample without a missing piece', () => {
    for (const row of catalog) {
      for (const f of row.findings) {
        const r = readFinding(row, f, codes);
        for (const part of [r.what, r.why, r.next]) {
          assert.ok(part.length > 0, `row ${row.row}`);
          assert.doesNotMatch(part, /undefined|null/, `row ${row.row}: ${part}`);
        }
      }
    }
  });

  it('names a short code for what it is, not just "not found"', () => {
    const short = catalog.find((r) => r.code?.length === 16);
    assert.ok(short, 'the sample has a code that lost its leading zero');
    const f = short.findings.find((x) => x.type === 'NOT_FOUND');
    assert.ok(f);
    assert.match(readFinding(short, f, codes).why, /16 ta raqam/);
  });
});

describe('helpers', () => {
  it('links the same sample file the generator writes', () => {
    assert.equal(SAMPLE_FILENAME, SCRIPT_FILENAME);
  });

  it('bands confidence like the app', () => {
    assert.equal(bandOf(0.95).key, 'high');
    assert.equal(bandOf(0.9).key, 'high');
    assert.equal(bandOf(0.6).key, 'medium');
    assert.equal(bandOf(0.59).key, 'low');
  });

  it('splits a code into its six levels and finds where two codes part', () => {
    assert.deepEqual(splitCode('02202002001010009'), ['022', '02', '002', '001', '010', '009']);
    assert.equal(splitCode('0220200200101002'), null);
    assert.equal(firstDivergence('02202002001010009', '02201001001011003'), 1);
    assert.equal(firstDivergence('02202002001010009', '02202002001010009'), -1);
  });

  it('reads an all-caps classifier group as a sentence and leaves others alone', () => {
    assert.equal(sentenceCase('ALKOGOLLI VA ALKOGOLSIZ IChIMLIKLAR'), 'Alkogolli va alkogolsiz ichimliklar');
    assert.equal(sentenceCase('Salqin alkogolsiz ichimliklar'), 'Salqin alkogolsiz ichimliklar');
  });
});
