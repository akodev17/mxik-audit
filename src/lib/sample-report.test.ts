// Checks the frozen landing-page sample (src/lib/sample-report.generated.ts).
//
// The static checks always run: they hold the generated file to the promises
// the landing page makes about it. The classifier check runs only when the
// local database is up and loaded; it then confirms, code by code, that every
// code the page shows exists in the classifier (or, for a NOT_FOUND row, that
// it really does not).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, describe, it } from 'node:test';
import { Pool } from 'pg';
import { SAMPLE_ROWS } from '../../scripts/landing-sample/catalog.js';
import { SAMPLE_REPORT } from './sample-report.generated.js';

const TYPES = ['MISSING', 'NOT_FOUND', 'MISMATCH', 'UNIT_CONFLICT'] as const;

/** The catalogue the report says it came from: the landing sample or a JSON fixture. */
const SOURCE_ROWS: readonly (readonly string[])[] = SAMPLE_REPORT.source.endsWith('.json')
  ? (JSON.parse(readFileSync(SAMPLE_REPORT.source, 'utf8')) as { rows: string[][] }).rows
  : SAMPLE_ROWS;
const CODE = /^\d{17}$/;

describe('sample report: static', () => {
  it('is a final run, not a draft', () => {
    assert.doesNotMatch(SAMPLE_REPORT.pipeline.embeddings, /DRAFT/, 'regenerate with npm run make:sample-report');
  });

  it('describes the sample catalogue it claims to', () => {
    assert.equal(SAMPLE_REPORT.totalRows, SOURCE_ROWS.length);
    const names = new Set(SOURCE_ROWS.map((r) => r[0]));
    for (const row of SAMPLE_REPORT.rows) assert.ok(names.has(row.productName), row.productName);
  });

  it('has totals that add up', () => {
    const findings = TYPES.reduce((sum, t) => sum + SAMPLE_REPORT.byType[t], 0);
    assert.ok(SAMPLE_REPORT.riskyRows <= SAMPLE_REPORT.totalRows);
    assert.ok(findings >= SAMPLE_REPORT.riskyRows, 'every risky row has at least one finding');
    for (const t of TYPES) {
      const shown = SAMPLE_REPORT.rows.filter((r) => r.type === t).length;
      assert.ok(shown <= SAMPLE_REPORT.byType[t], `${t}: shows more rows than it counted`);
    }
  });

  it('shows one row of every type that occurred first, for the hero figure', () => {
    const present = TYPES.filter((t) => SAMPLE_REPORT.byType[t] > 0);
    const head = SAMPLE_REPORT.rows.slice(0, present.length).map((r) => r.type);
    assert.deepEqual([...head].sort(), [...present].sort());
  });

  it('only shows well-formed 17-digit suggestions that resolved in the classifier', () => {
    for (const row of SAMPLE_REPORT.rows) {
      if (row.suggestedMxik === null) continue;
      assert.match(row.suggestedMxik, CODE, row.productName);
      assert.ok(row.suggestedName, `${row.suggestedMxik} was not resolved when generated`);
    }
  });

  it('resolved every current code except the ones reported as not found', () => {
    for (const row of SAMPLE_REPORT.rows) {
      if (row.currentMxik === null) {
        assert.equal(row.type, 'MISSING', row.productName);
        continue;
      }
      if (row.type === 'NOT_FOUND') {
        assert.equal(row.currentName, null, row.productName);
      } else {
        assert.match(row.currentMxik, CODE, row.productName);
        assert.ok(row.currentName, `${row.currentMxik} was not resolved when generated`);
      }
    }
  });

  it('gives every unit conflict the unit it should be, and keeps the code', () => {
    for (const row of SAMPLE_REPORT.rows.filter((r) => r.type === 'UNIT_CONFLICT')) {
      assert.ok(row.requiredUnit, row.productName);
      assert.equal(row.suggestedMxik, row.currentMxik, 'a unit fix does not change the code');
    }
  });
});

describe('sample report: against the classifier', async () => {
  const pool = new Pool({
    connectionString: process.env['DATABASE_URL'] ?? 'postgresql://mxik:mxik@localhost:54329/mxik',
    connectionTimeoutMillis: 1500,
    max: 1,
  });
  after(() => pool.end());

  let loaded = false;
  try {
    const r = await pool.query<{ n: string }>('SELECT count(*)::text AS n FROM mxik_code');
    loaded = Number(r.rows[0]?.n ?? 0) > 0;
  } catch {
    loaded = false;
  }

  it('every shown code exists in the classifier, and every NOT_FOUND code does not', { skip: !loaded && 'database not available' }, async () => {
    const codes = SAMPLE_REPORT.rows.flatMap((r) => [r.currentMxik, r.suggestedMxik]).filter((c): c is string => c !== null);
    const res = await pool.query<{ code: string }>('SELECT code FROM mxik_code WHERE code = ANY($1)', [codes]);
    const known = new Set(res.rows.map((r) => r.code));
    for (const row of SAMPLE_REPORT.rows) {
      if (row.suggestedMxik) assert.ok(known.has(row.suggestedMxik), `suggested ${row.suggestedMxik}`);
      if (row.currentMxik) {
        assert.equal(known.has(row.currentMxik), row.type !== 'NOT_FOUND', `current ${row.currentMxik} (${row.type})`);
      }
    }
  });
});
