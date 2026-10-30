// Statements written as payment documents (payer and payee, not debit and credit) turned into one
// statement table the parser already reads: a bank's own kl_to_1c.txt (1CClientBankExchange,
// bank research §1, §7.1–25) and the ASBT document export with payer/payee columns (§2.3, §7.39).
// The direction is decided by comparing the payer's and the payee's account with the statement's
// own accounts (§7.13), the 1C way; the dates ДатаСписано / ДатаПоступило are the fallback. The
// table's columns are the iBank2 statement CSV's names (samples/ibank_Corporate_iBank2-Format_Guide
// p.132) plus three of ours, so the same words read both. Pure.
import { isoDate, type ExchangeWarning, type ParsedExchange } from '../onec/bank-exchange.js';
import { addDecimals, readDecimal } from './decimal.js';
import { DOCUMENT_HEADERS } from './formats/builtin.js';
import { bankHeaderKey } from './vocabulary.js';
import type { BodyRow, PrintedAccount, StatementSheet } from './sheet.js';

/** One payment document, from either side. */
type Party = { account: string; name: string; inn: string; bankCode: string; bankName: string };
type Doc = {
  line: number;
  kind: string;
  number: string;
  date: string;
  amount: string;
  payer: Party;
  payee: Party;
  /** ДатаСписано / ДатаПоступило of a kl_to_1c document; '' elsewhere. */
  debited: string;
  credited: string;
  purpose: string;
  code: string;
};

/**
 * The own accounts' rows of the table: the document seen from the own account's side. Neither side
 * own: the dates decide (a document with only ДатаСписано left the account); else the amount goes
 * to the direction-less column and the parser reports the direction missing.
 */
function rowOf(doc: Doc, own: ReadonlySet<string>): string[] {
  const payerOwn = own.has(doc.payer.account);
  const payeeOwn = own.has(doc.payee.account);
  let side: 'debit' | 'credit' | null = null;
  if (payerOwn && !payeeOwn) side = 'debit';
  else if (payeeOwn && !payerOwn) side = 'credit';
  else if (doc.debited && !doc.credited) side = 'debit';
  else if (doc.credited && !doc.debited) side = 'credit';
  else if (payerOwn) side = 'debit';
  const ownSide = side === 'credit' ? doc.payee : side === 'debit' ? doc.payer : null;
  const other = side === 'credit' ? doc.payer : doc.payee;
  const posted = side === 'debit' ? doc.debited : side === 'credit' ? doc.credited : '';
  return [
    ownSide?.account ?? '', doc.date, doc.number, posted || doc.date,
    side === 'debit' ? doc.amount : '', side === 'credit' ? doc.amount : '', side === null ? doc.amount : '',
    other.name, other.inn, other.account, other.bankCode, other.bankName, doc.purpose, doc.code, doc.kind,
  ];
}

/** The statement sheet of a list of documents. */
export function sheetOf(titleRows: string[][], docs: readonly Doc[], own: ReadonlySet<string>, accounts: PrintedAccount[]): StatementSheet {
  const headers = [...DOCUMENT_HEADERS];
  const body: BodyRow[] = docs.map((d) => ({ line: d.line, cells: rowOf(d, own) }));
  return {
    headers, headerCells: headers, subHeaderCells: [], headerRow: 0, twoRowHeader: false,
    titleRows, titleLines: titleRows.map((r) => r.filter(Boolean).join(' · ')).slice(0, 20), body, extra: 0, accounts,
  };
}

// ── kl_to_1c.txt ─────────────────────────────────────────────────────────────────────────────

/**
 * `Плательщик=ИНН 7765434566\775001001 ОАО …` or `7719617469 ОАО "Крокус"` (research §1.6, §7.16):
 * the ИНН (and КПП) written before the name. Used only when `…ИНН` / `…1` are empty.
 */
export function compositeName(text: string): { inn: string; name: string } {
  const m = /^\s*(?:ИНН\s*)?(\d{9,14})(?:\s*[\\/]\s*\d{9})?\s+(.+)$/iu.exec(text);
  return m ? { inn: m[1] ?? '', name: (m[2] ?? '').trim() } : { inn: '', name: text.trim() };
}

/** `Сумма` as the standard writes it (§7.11): digits, an optional dot and 1–2 decimals. Anything else stays visibly invalid. */
const exchangeAmount = (raw: string): string => (/^\d+(\.\d{1,2})?$/.test(raw) ? raw : `Сумма=${raw}`);

function partyOf(doc: Record<string, string>, prefix: 'Плательщик' | 'Получатель'): Party {
  const composite = compositeName(doc[prefix] ?? '');
  const inn = doc[`${prefix}ИНН`] ?? '';
  return {
    account: doc[`${prefix}Счет`] || doc[`${prefix}РасчСчет`] || '',
    name: doc[`${prefix}1`] || composite.name,
    inn: inn && inn !== '0' ? inn : composite.inn,
    // Tasnivo's own uz_mfo variant writes …МФО; banks put the 5-digit МФО into …БИК (research §1.5).
    bankCode: doc[`${prefix}МФО`] || doc[`${prefix}БИК`] || '',
    bankName: [doc[`${prefix}Банк1`], doc[`${prefix}Банк2`]].filter(Boolean).join(', '),
  };
}

/** НазначениеПлатежа, else НазначениеПлатежа1..6 joined (research §7.23). */
function purposeOf(doc: Record<string, string>): string {
  if (doc['НазначениеПлатежа']) return doc['НазначениеПлатежа'];
  return [1, 2, 3, 4, 5, 6].map((i) => doc[`НазначениеПлатежа${i}`] ?? '').filter(Boolean).join(' ');
}

export type SectionWarning = { code: 'repeated_section' | 'overlapping_sections'; account: string };

/**
 * The printed balances per account from the СекцияРасчСчет blocks (§7.14–15): identical blocks
 * count once, the rest are ordered by ДатаНачала; the opening is the first block's, the closing
 * the last one's, the turnovers the sum. Overlapping intervals are reported.
 */
export function printedAccounts(parsed: ParsedExchange): { accounts: PrintedAccount[]; warnings: SectionWarning[] } {
  const byAccount = new Map<string, Record<string, string>[]>();
  const warnings: SectionWarning[] = [];
  for (const section of parsed.accounts) {
    const account = section['РасчСчет'] ?? '';
    const list = byAccount.get(account) ?? [];
    const key = JSON.stringify(section);
    if (list.some((s) => JSON.stringify(s) === key)) { warnings.push({ code: 'repeated_section', account }); continue; }
    list.push(section);
    byAccount.set(account, list);
  }
  const accounts: PrintedAccount[] = [];
  for (const [account, sections] of byAccount) {
    const iso = (v: string | undefined): string => (v ? isoDate(v) ?? '' : '');
    sections.sort((a, b) => iso(a['ДатаНачала']).localeCompare(iso(b['ДатаНачала'])));
    for (let i = 1; i < sections.length; i++) {
      const prevEnd = iso(sections[i - 1]?.['ДатаКонца']);
      if (prevEnd && iso(sections[i]?.['ДатаНачала']) <= prevEnd) warnings.push({ code: 'overlapping_sections', account });
    }
    const money = (v: string | undefined): string | null => (v === undefined || v === '' ? null : readDecimal(v, 'dot').value);
    const sum = (key: string): string | null => {
      const values = sections.map((s) => money(s[key]));
      if (values.some((v) => v === null)) return null;
      return addDecimals(...values.map((v) => v ?? '0'));
    };
    accounts.push({
      account,
      periodFrom: iso(sections[0]?.['ДатаНачала']) || null,
      periodTo: iso(sections[sections.length - 1]?.['ДатаКонца']) || null,
      opening: money(sections[0]?.['НачальныйОстаток']),
      closing: money(sections[sections.length - 1]?.['КонечныйОстаток']),
      credit: sum('ВсегоПоступило'),
      debit: sum('ВсегоСписано'),
    });
  }
  return { accounts, warnings };
}

export type ExchangeStatement = { sheet: StatementSheet; warnings: (ExchangeWarning | SectionWarning)[] };

/** A parsed kl_to_1c.txt as a statement table, its printed balances per account and what the reader recovered from. */
export function exchangeStatement(parsed: ParsedExchange): ExchangeStatement {
  const { accounts, warnings } = printedAccounts(parsed);
  const own = new Set([...(parsed.headerAll['РасчСчет'] ?? []), ...accounts.map((a) => a.account)].filter(Boolean));
  const docs: Doc[] = parsed.documents.map((d, i) => ({
    line: parsed.documentLines[i] ?? 0,
    kind: d._type,
    number: d['Номер'] ?? '',
    date: d['Дата'] ?? '',
    amount: exchangeAmount(d['Сумма'] ?? ''),
    payer: partyOf(d, 'Плательщик'),
    payee: partyOf(d, 'Получатель'),
    debited: d['ДатаСписано'] ?? '',
    credited: d['ДатаПоступило'] ?? '',
    purpose: purposeOf(d),
    code: d['КодНазПлатежа'] ?? '',
  }));
  const h = parsed.header;
  const titleRows: string[][] = [
    [`1CClientBankExchange ${h['ВерсияФормата'] ?? ''}`.trim()],
    ...(h['ДатаНачала'] || h['ДатаКонца'] ? [[`Период: с ${h['ДатаНачала'] ?? ''} по ${h['ДатаКонца'] ?? ''}`]] : []),
    ...[...own].map((a) => [`Счет: ${a}`]),
  ];
  return { sheet: sheetOf(titleRows, docs, own, accounts), warnings: [...parsed.warnings, ...warnings] };
}

// ── Payer/payee tables (ASBT «Экспорт документов») ──────────────────────────────────────────

/** Header words of a payment document's requisites (Положение о безналичных расчётах п.11; research §2.4). */
const PAYER_PAYEE: Record<string, readonly string[]> = {
  payerAccount: ['счет плательщика', 'р/с плательщика', 'счет отправителя', 'tolovchi hisob raqami', 'tolovchi hisobi', 'тўловчи ҳисоб рақами'],
  payeeAccount: ['счет получателя', 'р/с получателя', 'qabul qiluvchi hisob raqami', 'oluvchi hisob raqami', 'qabul qiluvchi hisobi', 'олувчи ҳисоб рақами'],
  payerName: ['наименование плательщика', 'плательщик', 'tolovchi nomi', 'tolovchi', 'тўловчи'],
  payeeName: ['наименование получателя', 'получатель', 'qabul qiluvchi nomi', 'qabul qiluvchi', 'oluvchi', 'олувчи'],
  payerInn: ['инн плательщика', 'tolovchi stiri', 'тўловчи стир'],
  payeeInn: ['инн получателя', 'qabul qiluvchi stiri', 'oluvchi stiri', 'олувчи стир'],
  payerMfo: ['мфо банка плательщика', 'мфо плательщика', 'tolovchi banki mfo', 'tolovchi mfo'],
  payeeMfo: ['мфо банка получателя', 'мфо получателя', 'qabul qiluvchi banki mfo', 'oluvchi mfo'],
  date: ['дата документа', 'дата', 'hujjat sanasi', 'sana'],
  valueDate: ['дата проводки', 'дата исполнения', 'дата операции', 'otkazilgan sana'],
  number: ['номер документа', '№ документа', 'номер', 'hujjat raqami'],
  amount: ['сумма', 'сумма платежа', 'summa', 'tolov summasi'],
  purpose: ['назначение платежа', 'детали платежа', 'назначение', 'tolov maqsadi', 'тўлов мақсади'],
  code: ['код назначения платежа', 'код назначения', 'код назн', 'tolov maqsadi kodi', 'maqsad kodi'],
  kind: ['вид документа', 'тип документа', 'hujjat turi'],
};

/** Payer/payee column positions, when the header names both accounts; else null. */
export function payerPayeeColumns(headers: readonly string[]): Record<string, number> | null {
  const keys = headers.map(bankHeaderKey);
  const used = new Set<number>();
  const out: Record<string, number> = {};
  // Exact names first, so "плательщик" never takes "счет плательщика".
  for (const exact of [true, false]) {
    for (const [field, words] of Object.entries(PAYER_PAYEE)) {
      if (out[field] !== undefined) continue;
      const at = keys.findIndex((k, i) => !used.has(i) && words.some((w) => (exact ? k === w : k.startsWith(`${w} `) || k.endsWith(` ${w}`))));
      if (at >= 0) { out[field] = at; used.add(at); }
    }
  }
  return out['payerAccount'] !== undefined && out['payeeAccount'] !== undefined && out['amount'] !== undefined && out['date'] !== undefined ? out : null;
}

/**
 * The statement's own accounts in a payer/payee table: the title's account when it printed one,
 * else the account on one side of most rows, then the next one for the rows still uncovered (an
 * export of several accounts), never one seen in a single row only.
 */
function ownAccounts(rows: readonly string[][], cols: Record<string, number>, titleAccount: string | null): Set<string> {
  const own = new Set<string>(titleAccount ? [titleAccount] : []);
  const sides = rows.map((r) => [r[cols['payerAccount'] ?? -1] ?? '', r[cols['payeeAccount'] ?? -1] ?? ''].map((a) => a.replace(/\s/g, '')));
  for (let round = 0; round < 10; round++) {
    const left = sides.filter(([a, b]) => !own.has(a ?? '') && !own.has(b ?? ''));
    if (left.length === 0) break;
    const tally = new Map<string, number>();
    for (const pair of left) for (const a of new Set(pair)) if (a) tally.set(a, (tally.get(a) ?? 0) + 1);
    const best = [...tally].sort((x, y) => y[1] - x[1])[0];
    if (!best || best[1] < 2) break;
    own.add(best[0]);
  }
  return own;
}

/** A located payer/payee table as a statement table; the title rows stay as they were. */
export function payerPayeeStatement(sheet: StatementSheet, cols: Record<string, number>, titleAccount: string | null): StatementSheet {
  const at = (r: readonly string[], field: string): string => (cols[field] === undefined ? '' : (r[cols[field] ?? -1] ?? '').trim());
  const own = ownAccounts(sheet.body.map((b) => b.cells), cols, titleAccount);
  const party = (r: readonly string[], side: 'payer' | 'payee'): Party => ({
    account: at(r, `${side}Account`).replace(/\s/g, ''), name: at(r, `${side}Name`), inn: at(r, `${side}Inn`), bankCode: at(r, `${side}Mfo`), bankName: '',
  });
  const docs: Doc[] = sheet.body.map(({ line, cells }) => ({
    line, kind: at(cells, 'kind'), number: at(cells, 'number'), date: at(cells, 'date'), amount: at(cells, 'amount'),
    payer: party(cells, 'payer'), payee: party(cells, 'payee'), debited: '', credited: '',
    purpose: at(cells, 'purpose'), code: at(cells, 'code'),
  }));
  const out = sheetOf(sheet.titleRows, docs, own, []);
  // The posting date is the document's own when the export has one; otherwise rowOf used the document date.
  if (cols['valueDate'] !== undefined) out.body.forEach((b, i) => { b.cells[3] = at(sheet.body[i]?.cells ?? [], 'valueDate') || (b.cells[1] ?? ''); });
  return { ...out, headerRow: sheet.headerRow, titleLines: sheet.titleLines, extra: sheet.extra };
}
