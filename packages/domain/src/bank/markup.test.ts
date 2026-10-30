// The HTML / Excel-2003-XML statement reader on hostile input (review 30 Oct): each unclosed construct
// used to make a pattern rescan to the end of the text, so 400 KB froze the API for 6 to 60 seconds.
// The bound below is two seconds for what now takes milliseconds; the old code needed far more.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { htmlGrid, spreadsheetMlGrid } from './markup.js';

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
