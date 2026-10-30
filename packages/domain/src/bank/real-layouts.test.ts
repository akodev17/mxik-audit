// Statements built strictly from documented layouts (fixtures/SOURCES.md): the CBU п.121 statement
// with a two-row header and a page break, the Colvir statement screen as a legacy .xls, ASBT's
// document export as '|' text in a zip and as fixed width, iBank2's one-file-all-accounts CSV; and
// the file shapes around them (PDF, archives, encodings, HTML and XML "xls"). Checklist items of
// bank research §7 in the comments; B1/B2/B6 are the plan's bug numbers.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import iconv from 'iconv-lite';
import JSZip from 'jszip';
import { lineFingerprint } from './duplicates.js';
import { contractIn, purposeCodeOf } from './parse.js';
import { readLines, readStatementFile, statementReadCode, type StatementFile } from './read.js';
import { reconcile } from './reconcile.js';

const fixture = (name: string): Buffer => readFileSync(new URL(`./fixtures/${name}`, import.meta.url));

async function read(bytes: Buffer): Promise<{ file: StatementFile; parsed: ReturnType<typeof readLines> }> {
  const file = await readStatementFile(bytes);
  assert.ok(file.builtIn, 'a built-in layout is recognised');
  return { file, parsed: readLines(file, file.builtIn.layout) };
}

function balance(parsed: ReturnType<typeof readLines>) {
  return reconcile(
    { openingBalance: parsed.meta.openingBalance, closingBalance: parsed.meta.closingBalance, bankTotals: parsed.extra.bankTotals, dropped: [] },
    parsed.lines.map((l) => ({ rowIndex: l.rowIndex, status: 'valid', payload: l.payload, issues: l.issues, note: null })),
  );
}

const refusal = async (bytes: Buffer): Promise<string> => {
  try {
    await readStatementFile(bytes);
    return 'read';
  } catch (error) {
    return statementReadCode(error);
  }
};

describe('CBU п.121 statement, two-row merged header (p121-two-row-header.xlsx)', () => {
  it('finds the header under the title block, joins the merged header and reads the title (B1: the МФО)', async () => {
    // bank §7.26 §7.27 §7.31
    const { file, parsed } = await read(fixture('p121-two-row-header.xlsx'));
    assert.equal(file.builtIn?.format.id, 'cbu_p121');
    assert.equal(file.sheet.twoRowHeader, true);
    assert.deepEqual(file.sheet.headers.slice(5, 11), ['Корреспондент МФО', 'Корреспондент Счет', 'Корреспондент Наименование', 'Корреспондент ИНН', 'Обороты Дебет', 'Обороты Кредит']);
    assert.equal(parsed.meta.mfo, '00444', 'B1: "(МФО 00444)" in the title is the owner\'s bank code');
    assert.equal(parsed.meta.account, '20208000900123456001');
    assert.equal(parsed.extra.ownInn, '301234567');
    assert.deepEqual([parsed.meta.periodFrom, parsed.meta.periodTo], ['2026-10-01', '2026-10-31']);
  });

  it('drops the column numbers, the page subtotal and footer, the repeated header, totals, closing balance and signature', async () => {
    // bank §7.32 §7.33
    const { parsed } = await read(fixture('p121-two-row-header.xlsx'));
    assert.equal(parsed.lines.length, 6);
    assert.deepEqual(parsed.dropped.map((d) => d.reason), ['column_numbers', 'continuation', 'subtotals', 'footer', 'repeated_header', 'repeated_header', 'totals', 'closing_balance', 'footer']);
    assert.equal(parsed.lines[3]?.payload.purpose, 'Уплата НДС за сентябрь 2026 года (налог на добавленную стоимость)', 'the wrapped purpose is joined');
  });

  it('B6: totals and balances are the printed ones and the lines reconcile with them', async () => {
    // bank §7.15 §7.32
    const { parsed } = await read(fixture('p121-two-row-header.xlsx'));
    assert.deepEqual([parsed.meta.openingBalance, parsed.meta.closingBalance], ['50000000', '61605000']);
    assert.deepEqual([parsed.meta.totalDebit, parsed.meta.totalCredit], ['4645000', '16250000'], 'from "Итого обороты", not the page subtotal');
    const r = balance(parsed);
    assert.deepEqual([r.balanced, r.bankTotals.debitMatches, r.bankTotals.creditMatches], [true, true, true]);
  });

  it('posting date vs document date, Excel numbers losing zeros, the purpose code from its column or the purpose', async () => {
    // bank §7.34 §7.35 §7.36 §7.38
    const { parsed } = await read(fixture('p121-two-row-header.xlsx'));
    const [first, second, fee, tax, fifth] = parsed.lines.map((l) => l.payload);
    assert.deepEqual([first?.date, first?.valueDate, first?.docNumber], ['2026-09-30', '2026-10-01', '00012']);
    assert.deepEqual([second?.date, second?.valueDate, second?.docNumber], ['2026-10-02', null, '12'], 'an Excel date cell; the number cell 12 lost its zeros');
    assert.equal(first?.counterparty.mfo, '00444', 'the number cell 444 padded back to five digits');
    assert.equal(second?.purposeCode, '00668', 'the code column\'s number 668');
    assert.equal(fee?.purposeCode, '00667', 'no code column value: the five digits opening the purpose');
    assert.equal(tax?.counterparty.mfo, '00014');
    assert.equal(fifth?.contract, null, '"по договору поставки" names no contract number');
    assert.equal(first?.contract, '4/28 от 01.01.2026');
    // The two spellings of document 12 are one key (§7.42): leading zeros do not make a new payment.
    assert.equal(lineFingerprint({ ...first, docNumber: '12' }), lineFingerprint(first));
  });
});

describe('Colvir statement screen as a legacy .xls (colvir-statement.xls)', () => {
  it('B2: a BIFF8 workbook is read, shared strings across CONTINUE records included', async () => {
    // bank §7.26 §7.28 §7.30
    const { file, parsed } = await read(fixture('colvir-statement.xls'));
    assert.equal(file.source.kind, 'xls');
    assert.equal(file.builtIn?.format.id, 'colvir_ib');
    assert.equal(parsed.lines.length, 72);
    const [first, second] = parsed.lines.map((l) => l.payload);
    assert.deepEqual([first?.date, first?.docNumber, first?.direction, first?.amount, first?.counterparty.mfo, first?.counterparty.account], ['2021-07-05', '548108', 'debit', '1234', '00401', '19997000900000000401']);
    assert.deepEqual([second?.docNumber, second?.amount, second?.counterparty.name], ['128', '500', 'ОАО РусМо…']);
    assert.equal(parsed.lines[71]?.payload.counterparty.name, 'МЧЖ «Ҳамкор Савдо 69»', 'Uzbek Cyrillic survives the UTF-16 strings');
  });

  it('the purpose printed under each payment, balances printed as label over value, per-side totals', async () => {
    // bank §7.27 §7.29 §7.32 §7.33
    const { parsed } = await read(fixture('colvir-statement.xls'));
    assert.equal(parsed.lines[0]?.payload.purpose, 'Исполнение платежного документа номер 548108');
    assert.equal(parsed.meta.account, '20208000700000568005');
    assert.deepEqual([parsed.meta.periodFrom, parsed.meta.periodTo], ['2021-06-16', '2021-07-16']);
    assert.deepEqual([parsed.meta.openingBalance, parsed.meta.closingBalance], ['6423', '286184.55']);
    assert.deepEqual([parsed.meta.totalDebit, parsed.meta.totalCredit], ['71868.75', '351630.3']);
    assert.deepEqual(parsed.dropped.filter((d) => d.reason !== 'continuation').map((d) => d.reason), ['subtotals', 'subtotals', 'totals', 'totals']);
    const r = balance(parsed);
    assert.deepEqual([r.balanced, r.bankTotals.debitMatches, r.bankTotals.creditMatches], [true, true, true]);
  });
});

describe('ASBT «Экспорт документов»: payer and payee, zipped "|" text and fixed width', () => {
  it('a zip with the dated .txt inside, "|" fields, payer/payee turned into debit and credit', async () => {
    // bank §7.39 §7.13 §7.28
    const { file, parsed } = await read(fixture('asbt-documents-pipe.zip'));
    assert.deepEqual([file.source.archived, file.source.delimiter, file.source.encoding], ['vypiska301026.txt', '|', 'windows-1251']);
    assert.equal(file.builtIn?.format.id, 'payer_payee_documents');
    assert.deepEqual(parsed.lines.map((l) => [l.payload.direction, l.payload.amount, l.payload.counterparty.name]), [
      ['debit', '7800000', 'OOO «Qurilish Savdo»'],
      ['credit', '15000000', 'MChJ «Toshkent Logistika»'],
      ['debit', '2340000', 'Давлат солик кумитаси'],
      ['credit', '980500.5', 'XK «Samarqand Non»'],
    ]);
    assert.ok(parsed.lines.every((l) => l.payload.ourAccount === '20208000900123456001'), 'the account on one side of every row is the own one');
    assert.deepEqual(parsed.lines.map((l) => l.payload.purposeCode), ['00664', '00664', '00102', '00664']);
  });

  it('fixed width: fields that touch are split at the header, the same payments as the delimited export', async () => {
    // bank §7.39 §7.42
    const fixed = await read(fixture('asbt-documents-fixed.txt'));
    const piped = await read(fixture('asbt-documents-pipe.zip'));
    assert.equal(fixed.file.source.fixedWidth, true);
    assert.equal(fixed.file.source.delimiter, null);
    assert.deepEqual(fixed.parsed.lines.map((l) => l.payload.counterparty.inn), ['302345678', '303456789', '200000000', '304567890']);
    assert.equal(fixed.parsed.lines[0]?.payload.purpose, 'Оплата по договору 4/28 от 01.01.2026 за услуги', 'one purpose, word gaps kept');
    assert.deepEqual(fixed.parsed.lines.map((l) => lineFingerprint(l.payload)), piped.parsed.lines.map((l) => lineFingerprint(l.payload)), 'the two exports are the same payments');
    // Two documents share number 1 the same day (different payers): never one payment (§7.24).
    assert.notEqual(lineFingerprint(fixed.parsed.lines[0].payload), lineFingerprint(fixed.parsed.lines[1]!.payload));
  });
});

describe('iBank2 statement CSV, one file for all accounts (ibank2-all-accounts.csv)', () => {
  it('rows grouped by the own account column, the guide\'s example rows read as printed', async () => {
    // bank §7.40 §7.30 §7.34
    const { file, parsed } = await read(fixture('ibank2-all-accounts.csv'));
    assert.equal(file.builtIn?.format.id, 'ibank2_csv');
    assert.deepEqual([file.source.delimiter, file.source.encoding], [';', 'windows-1251']);
    assert.deepEqual((parsed.extra.accounts ?? []).map((a) => [a.account, a.lines, a.lineDebit, a.lineCredit]), [
      ['40702810300180001774', 2, '0', '2516.13'],
      ['20208000900123456001', 3, '3445000', '12500000'],
    ]);
    const [guide, , uz] = parsed.lines.map((l) => l.payload);
    assert.deepEqual([guide?.amount, guide?.direction, guide?.counterparty.name, guide?.purpose], ['1256.13', 'credit', 'ОАО "Прогресс Парк"', 'оплата услуг']);
    assert.equal(file.sheet.body[0]?.cells[5], 'КЕМЕРОВСКИЙ ФИЛИАЛ ОАО БАНК ЗЕНИТ, г.КЕМЕРОВО', 'the quoted bank name with a comma stays one cell');
    assert.deepEqual([uz?.date, uz?.valueDate, uz?.docNumber, uz?.reference, uz?.purposeCode, uz?.counterparty.mfo], ['2026-09-30', '2026-10-01', '00012', 'A-1001', '00664', '00444']);
  });
});

describe('file shapes around the statement', () => {
  it('a PDF is refused with its own reason; a zip with two files or none is refused', async () => {
    // bank §7.41 §7.39
    assert.equal(await refusal(Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n')), 'pdf');
    const two = new JSZip();
    two.file('a.txt', 'x');
    two.file('b.txt', 'y');
    assert.equal(await refusal(await two.generateAsync({ type: 'nodebuffer' })), 'archive_many');
    const none = new JSZip();
    none.folder('empty');
    none.file('__MACOSX/._a.txt', 'x');
    assert.equal(await refusal(await none.generateAsync({ type: 'nodebuffer' })), 'archive_empty');
  });

  it('encodings by content: DOS cp866, UTF-8 with BOM; "~" as the delimiter', async () => {
    // bank §7.2 §7.39 §7.40
    const text = iconv.decode(fixture('ibank2-all-accounts.csv'), 'win1251');
    const dos = await read(iconv.encode(text, 'cp866'));
    assert.equal(dos.file.source.encoding, 'cp866');
    assert.equal(dos.parsed.lines[0]?.payload.counterparty.name, 'ОАО "Прогресс Парк"');
    const bom = await read(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text, 'utf8')]));
    assert.equal(bom.file.source.encoding, 'utf-8');
    assert.equal(bom.file.sheet.headers[0], 'Счет', 'the BOM is not part of the first header');
    const tilde = await read(iconv.encode(text.replace(/;/g, '~'), 'win1251'));
    assert.equal(tilde.file.source.delimiter, '~');
    assert.equal(tilde.parsed.lines.length, 5);
  });

  it('B2: an HTML table and an Excel 2003 XML document saved as .xls are read as sheets', async () => {
    // bank §7.26 (markup "xls" from web back offices)
    const html = `<html><head><meta charset="utf-8"></head><body><table><tr><td colspan="4">Выписка по счёту 20208000900123456001</td></tr>
      <tr><td colspan="4">Входящий остаток: 1&nbsp;000,00</td></tr></table>
      <table><tr><th>Дата</th><th>№ док.</th><th>Корреспондент</th><th>Дебет</th><th>Кредит</th><th>Назначение платежа</th></tr>
      <tr><td>01.10.2026</td><td>5</td><td>ООО &laquo;Альфа&raquo;</td><td>0,00</td><td>250,00</td><td>Оплата<br>за товар</td></tr>
      <tr><td>Исходящий остаток: 1&nbsp;250,00</td></tr></table></body></html>`;
    const fromHtml = await read(Buffer.from(html, 'utf8'));
    assert.equal(fromHtml.file.source.kind, 'html');
    assert.deepEqual([fromHtml.parsed.lines[0]?.payload.counterparty.name, fromHtml.parsed.lines[0]?.payload.purpose], ['ООО «Альфа»', 'Оплата за товар']);
    assert.deepEqual([fromHtml.parsed.meta.openingBalance, fromHtml.parsed.meta.closingBalance], ['1000', '1250']);
    const xml = `<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
      <Worksheet ss:Name="Выписка"><Table>
      <Row><Cell ss:MergeAcross="3"><Data ss:Type="String">Счет: 20208000900123456001</Data></Cell></Row>
      <Row ss:Index="3"><Cell><Data ss:Type="String">Дата</Data></Cell><Cell><Data ss:Type="String">Корреспондент</Data></Cell><Cell><Data ss:Type="String">Дебет</Data></Cell><Cell><Data ss:Type="String">Кредит</Data></Cell><Cell><Data ss:Type="String">Назначение платежа</Data></Cell></Row>
      <Row><Cell><Data ss:Type="String">02.10.2026</Data></Cell><Cell><Data ss:Type="String">MChJ «Beta»</Data></Cell><Cell><Data ss:Type="Number">120.5</Data></Cell><Cell ss:Index="5"><Data ss:Type="String">Xizmat haqi</Data></Cell></Row>
      </Table></Worksheet></Workbook>`;
    const fromXml = await read(Buffer.from(xml, 'utf8'));
    assert.equal(fromXml.file.source.kind, 'spreadsheetml');
    assert.deepEqual([fromXml.parsed.lines[0]?.payload.direction, fromXml.parsed.lines[0]?.payload.amount, fromXml.parsed.lines[0]?.payload.purpose], ['debit', '120.5', 'Xizmat haqi']);
    assert.equal(fromXml.parsed.meta.account, '20208000900123456001');
  });

  it('purpose codes and contract numbers as the real purposes write them', () => {
    // bank §7.38; the "по договору" case is from the odin_palace samples (bank §1.6)
    assert.equal(purposeCodeOf('', '00664 Оплата за консалтинг'), '00664');
    assert.equal(purposeCodeOf('', '00664-Оплата'), '00664');
    assert.equal(purposeCodeOf('', 'Оплата по счету 12345 от 01.10.2026'), null, 'five digits inside the text are not a code');
    assert.equal(purposeCodeOf('664', 'Оплата'), '00664');
    assert.equal(purposeCodeOf('0', 'Оплата'), null);
    assert.equal(contractIn('Оплата по договору'), null);
    assert.equal(contractIn('Оплата по договору № 15 от 02.03.2026'), '15 от 02.03.2026');
    assert.equal(contractIn("shartnoma № 7/2 dan 01.02.2026 bo'yicha"), '7/2 от 01.02.2026');
  });
});
