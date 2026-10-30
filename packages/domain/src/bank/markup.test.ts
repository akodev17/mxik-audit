// The HTML / Excel-2003-XML statement reader on hostile input (review 30 Oct): each unclosed construct
// used to make a pattern rescan to the end of the text, so 400 KB froze the API for 6 to 60 seconds.
// The bound below is two seconds for what now takes milliseconds; the old code needed far more.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { htmlGrid, spreadsheetMlGrid } from './markup.js';
import { GRID_ROWS, readStatementText } from './text.js';

const KB400 = 400 * 1024;
const fast = (label: string, run: () => unknown): void => {
  const started = performance.now();
  run();
  const ms = performance.now() - started;
  assert.ok(ms < 2_000, `${label}: ${ms.toFixed(0)} ms`);
};

describe('markup statement reader', () => {
  it('unclosed tags, comments and rows take linear time', () => {
    const html = '<html><table>';
    const xml = '<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet>';
    fast('a run of "<" in a cell', () => htmlGrid(`${html}<tr><td>${'<'.repeat(KB400)}</td></tr></table>`));
    fast('"<tr " never closed', () => htmlGrid(html + '<tr '.repeat(KB400 / 4)));
    fast('"<!--" never closed', () => htmlGrid(html + '<!--'.repeat(KB400 / 4)));
    fast('"<script" never closed', () => htmlGrid(html + '<script>'.repeat(KB400 / 8)));
    fast('"<Row>" never closed', () => spreadsheetMlGrid(xml + '<Row>'.repeat(KB400 / 5)));
    fast('"<Cell>" never closed', () => spreadsheetMlGrid(`${xml}<Row>${'<Cell>'.repeat(KB400 / 6)}</Row></Worksheet>`));
  });

  it('still reads what it read: comments and scripts dropped, colspan, self-closing and indexed rows', () => {
    const html = '<html><!-- <tr><td>no</td></tr> --><script>var t = "<tr><td>no</td></tr>";</script><table>'
      + '<tr><th colspan="2">Дата &amp; №</th><td>Сумма</td></tr><tr><td>01.10.2026<td>5<td>1&nbsp;000,00</tr></table>';
    assert.deepEqual(htmlGrid(html), [['Дата & №', '', 'Сумма'], ['01.10.2026', '5', '1 000,00']]);
    const xml = '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet><Table>'
      + '<Row><Cell><Data ss:Type="String">Дата</Data></Cell><Cell ss:Index="3"><Data>Сумма</Data></Cell></Row>'
      + '<Row/><Row ss:Index="4"><Cell ss:MergeAcross="1"><Data>01.10.2026</Data></Cell><Cell><Data>1000</Data></Cell></Row>'
      + '</Table></Worksheet></Workbook>';
    assert.deepEqual(spreadsheetMlGrid(xml), [['Дата', '', 'Сумма'], [], [], ['01.10.2026', '', '1000']]);
  });
});

describe('grid row cap (review 30 Oct, R-B2b)', () => {
  it('text and HTML statements keep GRID_ROWS rows and count the rest, instead of building them all', () => {
    const header = 'Дата;№;Сумма;Назначение';
    const body = Array.from({ length: GRID_ROWS + 499 }, (_, i) => `01.10.2026;${i};1000,00;Оплата`);
    const text = readStatementText(Buffer.from([header, ...body].join('\r\n'), 'utf8'));
    assert.equal(text.grid.length, GRID_ROWS);
    assert.equal(text.extra, 500);
    const limit = { maxRows: GRID_ROWS, extra: 0 };
    const rows = htmlGrid(`<table>${Array.from({ length: GRID_ROWS + 10 }, (_, i) => `<tr><td>${i}</td></tr>`).join('')}</table>`, limit);
    assert.deepEqual([rows.length, limit.extra], [GRID_ROWS, 10]);
  });
});

describe('HTML two-row headers', () => {
  it('a rowspan keeps the lower header row in its columns (review 30 Oct, R-B10)', () => {
    // Дата … span both header rows, «Обороты» splits into Дебет / Кредит below; without rowspan the lower row shifted
    // left, the headers read "Дата Дебет", "№ документа Кредит", and every line had amount_missing.
    const html = '<table><tr><th rowspan=2>Дата</th><th rowspan="2">№</th><th colspan=2>Обороты</th><th rowspan=2>Назначение</th></tr>'
      + '<tr><th>Дебет</th><th>Кредит</th></tr><tr><td>01.10.2026</td><td>5</td><td>1 000,00</td><td></td><td>Оплата</td></tr></table>';
    assert.deepEqual(htmlGrid(html), [
      ['Дата', '№', 'Обороты', '', 'Назначение'],
      ['', '', 'Дебет', 'Кредит', ''],
      ['01.10.2026', '5', '1 000,00', '', 'Оплата'],
    ]);
  });
});
