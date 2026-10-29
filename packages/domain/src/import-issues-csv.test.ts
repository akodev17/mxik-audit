import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { i18nFor } from '@tasnivo/i18n/locale';
import { eachImportIssue, importDiagnostics, type ImportIssue } from './import-diagnostics.js';
import { importIssuesCsv } from './import-issues-csv.js';

const MAP = { name: 0, barcode: 1, mxik: 2, unit: 3, price: 4, sales: -1, tnved: -1 };
const HEADERS = ['Nomi', 'Shtrix-kod', 'MXIK', 'Birlik', 'Narx', 'Izoh'];
const ROWS = [
  ['Guruch', '4780074540164', '06301001001000000', 'kg', '12 000', 'Olma'],
  ['', '', '06301001001000000', 'kg', '5', 'jami'],
  ['guruch', '4780074540164', '6301001001000000', 'KG', '12,500', 'Nok'],
  ['Shakar', '', '123', 'kg', '7', 'Nok'],
  ['Tuz', '', '-', 'kg', '=1+1', ''],
];

const csvLines = (csv: string): string[] => csv.replace(/^\uFEFF/, '').split('\r\n').filter((l) => l !== '');

describe('import issues, row by row', () => {
  it('the walk is the counts: every issue the panel counts is one line, ambiguous amounts once per row', () => {
    const issues: ImportIssue[] = [];
    eachImportIssue(ROWS, MAP, (i) => issues.push(i));
    const d = importDiagnostics(ROWS, MAP);
    const rowsOf = (...kinds: ImportIssue['kind'][]) => [...new Set(issues.filter((i) => kinds.includes(i.kind)).map((i) => i.row))];
    assert.deepEqual(rowsOf('noName'), d.noName.sample);
    assert.deepEqual(rowsOf('duplicate'), d.duplicates.sample);
    assert.deepEqual(rowsOf('badCode', 'lostZero'), d.badCodes.sample);
    assert.deepEqual(rowsOf('lostZero'), d.lostZero.sample);
    assert.deepEqual(rowsOf('noCode'), d.noCode.sample);
    assert.deepEqual(rowsOf('ambiguousAmount'), d.ambiguousAmounts.sample);
    assert.deepEqual(issues.find((i) => i.kind === 'duplicate'), { row: 3, field: 'name', kind: 'duplicate', value: 'guruch', firstRow: 1 });
  });

  it('writes file line, data row, column, reason and the cell, in the reader\'s language', () => {
    const labels = i18nFor('uz').ta.importX.issuesCsv;
    const parse = { headerRow: 3, lineJumps: [[1, 4]] as [number, number][], truncated: false, totalSeen: 5 };
    const csv = importIssuesCsv({ headers: HEADERS, rows: ROWS, mapping: MAP, parse }, labels);
    assert.ok(csv.startsWith('\uFEFF'), 'a BOM so Excel reads Uzbek and Cyrillic');
    const lines = csvLines(csv);
    const c = labels.columns;
    assert.equal(lines[0], [c.line, c.row, c.column, c.reason, c.value].join(','));
    assert.ok(lines.includes(`5,2,Nomi,${labels.reasons.noName},`), 'no name: file line 5 (header on 3, data from 4)');
    assert.ok(lines.includes(`6,3,Nomi,"${labels.duplicate('4')}",guruch`), 'a duplicate names the line it repeats');
    assert.ok(lines.includes(`6,3,MXIK,${labels.reasons.lostZero},"=""6301001001000000"""`), 'a code stays text with all its digits');
    assert.ok(lines.includes(`7,4,MXIK,${labels.reasons.badCode},"=""123"""`));
    assert.ok(lines.includes(`8,5,MXIK,${labels.reasons.noCode},'-`), 'a formula-like cell is defused');
    assert.ok(lines.includes(`6,3,Narx,${labels.reasons.ambiguousAmount},"12,500"`));
  });

  it('adds one line for rows past the row limit and one for cells past the column limit; data rows when lines are unknown', () => {
    const labels = i18nFor('ru').ta.importX.issuesCsv;
    const parse = { headerRow: 1, lineJumps: null, truncated: true, totalSeen: 9, cellsPastColumnLimit: 3 };
    const lines = csvLines(importIssuesCsv({ headers: HEADERS, rows: ROWS, mapping: MAP, parse }, labels));
    assert.ok(lines.includes(`,2,Nomi,${labels.reasons.noName},`), 'no file line without lineJumps, the data row stays');
    assert.ok(lines.includes(`,6–9,,${labels.notRead(4)},`));
    assert.ok(lines.includes(`,,> 500,${labels.pastColumns(3, 500)},`));
  });

  it('only the header when nothing is wrong', () => {
    const labels = i18nFor('uz').ta.importX.issuesCsv;
    const lines = csvLines(importIssuesCsv({ headers: HEADERS, rows: [ROWS[0] ?? []], mapping: MAP, parse: null }, labels));
    assert.equal(lines.length, 1);
  });
});
