// The 1CClientBankExchange text file, version 1.02: what «Банк и касса → Банковские выписки →
// Загрузить» reads. Keys from the official 1C standard «Стандарт обмена с системами Клиент банка»
// (v8.1c.ru, formats page; docs/accounting-2026-10-23/integration-research.md §2). The Uzbek
// edition's exact key set is not published (research note §2 "Unknown" 1), so the file follows the
// Russian standard; with `bankKeys: 'uz_mfo'` the МФО is written a second time under
// ПлательщикМФО / ПолучательМФО. docs/accounting-2026-10-23/onec-formats.md documents both.
// Pure: no database. Encoding windows-1251 (Кодировка=Windows), lines end in CRLF.
import iconv from 'iconv-lite';
import { money2 } from './decimal.js';

export type BankKeys = 'standard' | 'uz_mfo';

/** One side of a payment as the file names it. */
export type ExchangeParty = { name: string; inn: string | null; account: string | null; bankName: string | null; mfo: string | null };

/** One payment document of the file. `direction` is from the statement owner's side. */
export type ExchangeDocument = {
  number: string;
  /** YYYY-MM-DD. */
  date: string;
  amount: string;
  direction: 'debit' | 'credit';
  /** The statement owner (its account is the statement's account). */
  owner: ExchangeParty;
  counterparty: ExchangeParty;
  purpose: string;
  /** Posting date when it differs from the document date. */
  valueDate: string | null;
};

export type ExchangeFile = {
  account: string;
  /** YYYY-MM-DD. */
  periodFrom: string;
  periodTo: string;
  /** Written only when known; totals are always computed from the documents. */
  openingBalance: string | null;
  closingBalance: string | null;
  documents: readonly ExchangeDocument[];
  bankKeys: BankKeys;
  sender: string;
  receiver: string;
  createdAt: Date;
};

export const EXCHANGE_FILENAME = 'kl_to_1c.txt';
export const EXCHANGE_CONTENT_TYPE = 'text/plain; charset=windows-1251';
const EOL = '\r\n';

/** YYYY-MM-DD → DD.MM.YYYY, as the standard writes dates. */
export function ruDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

/** DD.MM.YYYY → YYYY-MM-DD; null for anything else. */
export function isoDate(ru: string): string | null {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(ru.trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

/** Tashkent wall-clock date and time of `at` (UTC+5, no daylight saving). */
function tashkent(at: Date): { date: string; time: string } {
  const local = new Date(at.getTime() + 5 * 3_600_000).toISOString();
  return { date: local.slice(0, 10), time: local.slice(11, 19) };
}

/** A value fits on one line: no CR/LF (the format is line based), no leading/trailing blanks. */
function oneLine(value: string): string {
  return value.replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim();
}

function partyLines(prefix: 'Плательщик' | 'Получатель', p: ExchangeParty, bankKeys: BankKeys): string[] {
  const lines = [
    `${prefix}Счет=${p.account ?? ''}`,
    `${prefix}=${oneLine(p.name)}`,
    `${prefix}ИНН=${p.inn ?? ''}`,
    `${prefix}1=${oneLine(p.name)}`,
    `${prefix}РасчСчет=${p.account ?? ''}`,
    `${prefix}Банк1=${oneLine(p.bankName ?? '')}`,
    // Uzbek banks are identified by the 5-digit МФО; the standard's slot for the bank code is БИК.
    `${prefix}БИК=${p.mfo ?? ''}`,
  ];
  if (bankKeys === 'uz_mfo') lines.push(`${prefix}МФО=${p.mfo ?? ''}`);
  return lines;
}

function documentLines(doc: ExchangeDocument, bankKeys: BankKeys): string[] {
  const outgoing = doc.direction === 'debit';
  const payer = outgoing ? doc.owner : doc.counterparty;
  const payee = outgoing ? doc.counterparty : doc.owner;
  const posted = ruDate(doc.valueDate ?? doc.date);
  const [payerAccount, ...payerRest] = partyLines('Плательщик', payer, bankKeys);
  const [payeeAccount, ...payeeRest] = partyLines('Получатель', payee, bankKeys);
  return [
    'СекцияДокумент=Платежное поручение',
    `Номер=${oneLine(doc.number)}`,
    `Дата=${ruDate(doc.date)}`,
    `Сумма=${money2(doc.amount)}`,
    payerAccount ?? '',
    // The standard's order: the payer's account, then the date it left it (outgoing payments only).
    ...(outgoing ? [`ДатаСписано=${posted}`] : []),
    ...payerRest,
    payeeAccount ?? '',
    ...(outgoing ? [] : [`ДатаПоступило=${posted}`]),
    ...payeeRest,
    'ВидОплаты=01',
    `НазначениеПлатежа=${oneLine(doc.purpose)}`,
    'КонецДокумента',
  ];
}

/** The file as text (before encoding): header, one account section, the documents, the end. */
export function bankExchangeText(file: ExchangeFile): string {
  const created = tashkent(file.createdAt);
  let totalIn = 0n;
  let totalOut = 0n;
  for (const d of file.documents) {
    const cents = BigInt(money2(d.amount).replace('.', ''));
    if (d.direction === 'credit') totalIn += cents;
    else totalOut += cents;
  }
  const centsText = (c: bigint): string => money2(`${c / 100n}.${(c % 100n).toString().padStart(2, '0')}`);
  const closing = file.closingBalance ?? (file.openingBalance !== null
    ? centsText(BigInt(money2(file.openingBalance).replace('.', '')) + totalIn - totalOut)
    : null);
  const lines = [
    '1CClientBankExchange',
    'ВерсияФормата=1.02',
    'Кодировка=Windows',
    `Отправитель=${oneLine(file.sender)}`,
    `Получатель=${oneLine(file.receiver)}`,
    `ДатаСоздания=${ruDate(created.date)}`,
    `ВремяСоздания=${created.time}`,
    `ДатаНачала=${ruDate(file.periodFrom)}`,
    `ДатаКонца=${ruDate(file.periodTo)}`,
    `РасчСчет=${file.account}`,
    'Документ=Платежное поручение',
    'СекцияРасчСчет',
    `ДатаНачала=${ruDate(file.periodFrom)}`,
    `ДатаКонца=${ruDate(file.periodTo)}`,
    `РасчСчет=${file.account}`,
    ...(file.openingBalance !== null ? [`НачальныйОстаток=${money2(file.openingBalance)}`] : []),
    `ВсегоПоступило=${centsText(totalIn)}`,
    `ВсегоСписано=${centsText(totalOut)}`,
    ...(closing !== null ? [`КонечныйОстаток=${money2(closing)}`] : []),
    'КонецРасчСчет',
    ...file.documents.flatMap((d) => documentLines(d, file.bankKeys)),
    'КонецФайла',
  ];
  return lines.join(EOL) + EOL;
}

/** The file as windows-1251 bytes. Characters outside the code page (Uzbek ʻ, ғ, қ, ў, ҳ) become their nearest Russian letter. */
export function buildBankExchange(file: ExchangeFile): Buffer {
  return iconv.encode(foldForCp1251(bankExchangeText(file)), 'win1251');
}

// Uzbek Cyrillic letters and Latin apostrophes windows-1251 cannot hold; iconv would write '?'.
const CP1251_FOLD: Record<string, string> = {
  'ғ': 'г', 'Ғ': 'Г', 'қ': 'к', 'Қ': 'К', 'ў': 'у', 'Ў': 'У', 'ҳ': 'х', 'Ҳ': 'Х',
  'ʻ': "'", 'ʼ': "'", '‘': "'", '’': "'", '“': '"', '”': '"', '„': '"', '–': '-', '—': '-',
};

export function foldForCp1251(text: string): string {
  return text.replace(/[ғҒқҚўЎҳҲʻʼ‘’“”„–—]/g, (c) => CP1251_FOLD[c] ?? c);
}

// ── Reading (round-trip tests, and a real export from a client's 1C once the owner has one) ────

export type ParsedExchange = {
  header: Record<string, string>;
  accounts: Record<string, string>[];
  documents: (Record<string, string> & { _type: string })[];
};

/** Decodes by the file's own `Кодировка` (Windows = 1251, DOS = 866); a UTF-8 BOM wins. */
export function decodeBankExchange(bytes: Uint8Array): string {
  const buffer = Buffer.from(bytes);
  if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) return buffer.subarray(3).toString('utf8');
  const asWindows = iconv.decode(buffer, 'win1251');
  return /Кодировка=DOS/i.test(asWindows) ? iconv.decode(buffer, 'cp866') : asWindows;
}

/** Parses the key=value lines into the header, the account sections and the documents. */
export function parseBankExchange(input: Uint8Array | string): ParsedExchange {
  const text = typeof input === 'string' ? input : decodeBankExchange(input);
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines[0] !== '1CClientBankExchange') throw new Error('not a 1CClientBankExchange file');
  const out: ParsedExchange = { header: {}, accounts: [], documents: [] };
  let current: Record<string, string> | null = null;
  for (const line of lines.slice(1)) {
    if (line === 'КонецФайла') break;
    if (line === 'СекцияРасчСчет') { current = {}; out.accounts.push(current); continue; }
    if (line === 'КонецРасчСчет' || line === 'КонецДокумента') { current = null; continue; }
    const eq = line.indexOf('=');
    const key = eq >= 0 ? line.slice(0, eq) : line;
    const value = eq >= 0 ? line.slice(eq + 1) : '';
    if (key === 'СекцияДокумент') {
      const doc = { _type: value } as Record<string, string> & { _type: string };
      out.documents.push(doc);
      current = doc;
      continue;
    }
    (current ?? out.header)[key] = value;
  }
  return out;
}

/** A parsed document back as the builder's input, seen from `account`'s side. */
export function exchangeDocumentOf(doc: Record<string, string>, account: string): ExchangeDocument {
  const party = (prefix: 'Плательщик' | 'Получатель'): ExchangeParty => ({
    name: doc[prefix] ?? '',
    inn: doc[`${prefix}ИНН`] || null,
    account: doc[`${prefix}РасчСчет`] || doc[`${prefix}Счет`] || null,
    bankName: doc[`${prefix}Банк1`] || null,
    mfo: doc[`${prefix}МФО`] || doc[`${prefix}БИК`] || null,
  });
  const payer = party('Плательщик');
  const payee = party('Получатель');
  const outgoing = (doc['ПлательщикСчет'] ?? payer.account) === account;
  const date = isoDate(doc['Дата'] ?? '') ?? '';
  const posted = isoDate((outgoing ? doc['ДатаСписано'] : doc['ДатаПоступило']) ?? '');
  return {
    number: doc['Номер'] ?? '',
    date,
    amount: doc['Сумма'] ?? '',
    direction: outgoing ? 'debit' : 'credit',
    owner: outgoing ? payer : payee,
    counterparty: outgoing ? payee : payer,
    purpose: doc['НазначениеПлатежа'] ?? '',
    valueDate: posted && posted !== date ? posted : null,
  };
}
