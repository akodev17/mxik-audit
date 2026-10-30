// The 1CClientBankExchange text file, version 1.02: what «Банк и касса → Банковские выписки →
// Загрузить» reads. Keys from the official 1C standard «Стандарт обмена с системами Клиент банка»
// (v8.1c.ru, formats page; docs/accounting-2026-10-23/integration-research.md §2). The Uzbek
// edition's exact key set is not published (research note §2 "Unknown" 1), so the file follows the
// Russian standard; with `bankKeys: 'uz_mfo'` the МФО is written a second time under
// ПлательщикМФО / ПолучательМФО. docs/accounting-2026-10-23/onec-formats.md documents both.
// Pure: no database. Encoding windows-1251 (Кодировка=Windows), lines end in CRLF.
import iconv from 'iconv-lite';
import { decodeCyrillic } from '../spreadsheet-text.js';
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
  /** The 5-digit CBU payment-purpose code: the standard has no field for it, so it opens НазначениеПлатежа (bank research §7.44). */
  purposeCode?: string | null;
};

/** One own account of a file with several (bank research §7.44: one СекцияРасчСчет per account). */
export type ExchangeSection = { account: string; openingBalance: string | null; closingBalance: string | null };

export type ExchangeFile = {
  account: string;
  /** YYYY-MM-DD. */
  periodFrom: string;
  periodTo: string;
  /** Written only when known; totals are always computed from the documents. */
  openingBalance: string | null;
  closingBalance: string | null;
  documents: readonly ExchangeDocument[];
  /**
   * The own accounts when the documents span several (each document's owner.account names its
   * own); absent = the one `account` above with the balances above.
   */
  sections?: readonly ExchangeSection[];
  bankKeys: BankKeys;
  sender: string;
  receiver: string;
  createdAt: Date;
  /** `Кодировка`: Windows (cp1251, the default) or DOS (cp866); the bytes follow it (onec §8.18). */
  encoding?: 'Windows' | 'DOS';
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

/** The purpose with its code in front, unless the purpose already opens with it. */
function purposeText(doc: ExchangeDocument): string {
  const purpose = oneLine(doc.purpose);
  const code = doc.purposeCode;
  return code && !purpose.startsWith(code) ? `${code} ${purpose}`.trim() : purpose;
}

/**
 * Document numbers made unique per (account, kind, date, number), the identity 1C and the iBank2
 * guide use (bank research §1.2): Uzbek banks reuse small numbers, and 1C would load only one of two
 * documents sharing it («Документ уже загружен», onec §8.20). The second becomes "1/2", the third "1/3".
 */
export function uniqueNumbers(documents: readonly ExchangeDocument[], fallbackAccount: string): string[] {
  const seen = new Map<string, number>();
  return documents.map((d) => {
    const number = oneLine(d.number);
    const key = [d.owner.account ?? fallbackAccount, d.date, number].join('|');
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    return n === 1 ? number : `${number}/${n}`;
  });
}

function documentLines(doc: ExchangeDocument, bankKeys: BankKeys, number: string = doc.number): string[] {
  const outgoing = doc.direction === 'debit';
  const payer = outgoing ? doc.owner : doc.counterparty;
  const payee = outgoing ? doc.counterparty : doc.owner;
  const posted = ruDate(doc.valueDate ?? doc.date);
  const [payerAccount, ...payerRest] = partyLines('Плательщик', payer, bankKeys);
  const [payeeAccount, ...payeeRest] = partyLines('Получатель', payee, bankKeys);
  return [
    'СекцияДокумент=Платежное поручение',
    `Номер=${oneLine(number)}`,
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
    `НазначениеПлатежа=${purposeText(doc)}`,
    'КонецДокумента',
  ];
}

const cents = (amount: string): bigint => BigInt(money2(amount).replace('.', ''));
const centsText = (c: bigint): string => money2(`${c < 0n ? '-' : ''}${(c < 0n ? -c : c) / 100n}.${((c < 0n ? -c : c) % 100n).toString().padStart(2, '0')}`);

/** One СекцияРасчСчет: the balances when known, the turnovers computed from the account's documents. */
function sectionLines(file: ExchangeFile, section: ExchangeSection, documents: readonly ExchangeDocument[]): string[] {
  let totalIn = 0n;
  let totalOut = 0n;
  for (const d of documents) {
    if (d.direction === 'credit') totalIn += cents(d.amount);
    else totalOut += cents(d.amount);
  }
  const closing = section.closingBalance ?? (section.openingBalance !== null ? centsText(cents(section.openingBalance) + totalIn - totalOut) : null);
  return [
    'СекцияРасчСчет',
    `ДатаНачала=${ruDate(file.periodFrom)}`,
    `ДатаКонца=${ruDate(file.periodTo)}`,
    `РасчСчет=${section.account}`,
    ...(section.openingBalance !== null ? [`НачальныйОстаток=${money2(section.openingBalance)}`] : []),
    `ВсегоПоступило=${centsText(totalIn)}`,
    `ВсегоСписано=${centsText(totalOut)}`,
    ...(closing !== null ? [`КонечныйОстаток=${money2(closing)}`] : []),
    'КонецРасчСчет',
  ];
}

/** The file as text (before encoding): header, one account section per own account, the documents, the end. */
export function bankExchangeText(file: ExchangeFile): string {
  const created = tashkent(file.createdAt);
  const sections: readonly ExchangeSection[] = file.sections?.length
    ? file.sections
    : [{ account: file.account, openingBalance: file.openingBalance, closingBalance: file.closingBalance }];
  const single = sections.length === 1;
  const ofSection = (account: string): ExchangeDocument[] => (single ? [...file.documents] : file.documents.filter((d) => (d.owner.account ?? file.account) === account));
  const numbers = uniqueNumbers(file.documents, file.account);
  const lines = [
    '1CClientBankExchange',
    'ВерсияФормата=1.02',
    `Кодировка=${file.encoding ?? 'Windows'}`,
    `Отправитель=${oneLine(file.sender)}`,
    `Получатель=${oneLine(file.receiver)}`,
    `ДатаСоздания=${ruDate(created.date)}`,
    `ВремяСоздания=${created.time}`,
    `ДатаНачала=${ruDate(file.periodFrom)}`,
    `ДатаКонца=${ruDate(file.periodTo)}`,
    ...sections.map((x) => `РасчСчет=${x.account}`),
    'Документ=Платежное поручение',
    ...sections.flatMap((x) => sectionLines(file, x, ofSection(x.account))),
    ...file.documents.flatMap((d, i) => documentLines(d, file.bankKeys, numbers[i])),
    'КонецФайла',
  ];
  return lines.join(EOL) + EOL;
}

/**
 * The file as bytes in its `Кодировка`: windows-1251, or cp866 for DOS; no BOM. Characters outside the
 * code page (Uzbek ʻ, ғ, қ, ў, ҳ; for DOS also «» and dashes) become their nearest Russian letter or sign.
 */
export function buildBankExchange(file: ExchangeFile): Buffer {
  const text = foldForCp1251(bankExchangeText(file));
  return file.encoding === 'DOS' ? iconv.encode(text.replace(/[«»]/g, '"'), 'cp866') : iconv.encode(text, 'win1251');
}

// Uzbek Cyrillic letters and Latin apostrophes windows-1251 cannot hold; iconv would write '?'.
const CP1251_FOLD: Record<string, string> = {
  'ғ': 'г', 'Ғ': 'Г', 'қ': 'к', 'Қ': 'К', 'ў': 'у', 'Ў': 'У', 'ҳ': 'х', 'Ҳ': 'Х',
  'ʻ': "'", 'ʼ': "'", '‘': "'", '’': "'", '“': '"', '”': '"', '„': '"', '–': '-', '—': '-',
};

const inCp1251 = new Map<string, boolean>();
/** The character has a byte of its own in windows-1251 (iconv writes '?' for one that has none). */
const encodable = (c: string): boolean => {
  let ok = inCp1251.get(c);
  if (ok === undefined) {
    ok = c === '?' || iconv.encode(c, 'win1251')[0] !== 0x3f;
    inCp1251.set(c, ok);
  }
  return ok;
};

export function foldForCp1251(text: string): string {
  // Then any other letter windows-1251 lacks loses its accent ("Türkiye … Bankası Şirket" → "Turkiye … Bankasi Sirket"),
  // rather than becoming '?'; letters it has (й, ё) are left alone (review 30 Oct, R-B12).
  return text.replace(/[ғҒқҚўЎҳҲʻʼ‘’“”„–—]/g, (c) => CP1251_FOLD[c] ?? c)
    .replace(/[\u0080-\uffff]/g, (c) => (encodable(c) ? c : c === 'ı' ? 'i' : c.normalize('NFD').replace(/\p{M}/gu, '') || c));
}

// ── Reading: round-trip tests, and a bank's own kl_to_1c.txt uploaded as a statement (bank/exchange-input.ts) ──

export type ExchangeWarningCode =
  | 'duplicate_key' | 'missing_end_document' | 'missing_end_account' | 'missing_end_file' | 'unknown_version' | 'line_without_key';

/** Something the reader recovered from (odin_palace's malformed-file suites; bank research §1.6, §7.8–9). */
export type ExchangeWarning = { line: number; code: ExchangeWarningCode; key?: string };

export type ExchangeEncoding = 'utf-8' | 'windows-1251' | 'cp866';

export type ParsedExchange = {
  /** First value of each header key. */
  header: Record<string, string>;
  /** Every value of each header key: `РасчСчет` and `Документ` repeat (research §7.7). */
  headerAll: Record<string, string[]>;
  accounts: Record<string, string>[];
  documents: (Record<string, string> & { _type: string })[];
  /** The file line of each document's СекцияДокумент, parallel to `documents`. */
  documentLines: number[];
  warnings: ExchangeWarning[];
  encoding: ExchangeEncoding | null;
};

/** The encoding of the bytes, by content (research §7.2): a UTF-8 BOM or valid UTF-8 wins over the declared `Кодировка`. */
export function exchangeEncoding(bytes: Uint8Array): ExchangeEncoding {
  const buffer = Buffer.from(bytes);
  if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) return 'utf-8';
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    return 'utf-8';
  } catch {
    // The key itself is Cyrillic, so each reading is tried: the one that finds 'Кодировка=DOS' is a DOS file.
    if (/Кодировка\s*=\s*DOS/i.test(iconv.decode(buffer, 'cp866'))) return 'cp866';
    if (/Кодировка\s*=\s*Windows/i.test(iconv.decode(buffer, 'win1251'))) return 'windows-1251';
    return decodeCyrillic(buffer).encoding;
  }
}

/** Decodes by content: UTF-8 (with or without BOM, whatever `Кодировка` says), else DOS = 866, Windows = 1251. */
export function decodeBankExchange(bytes: Uint8Array): string {
  const buffer = Buffer.from(bytes);
  const encoding = exchangeEncoding(buffer);
  if (encoding === 'utf-8') return buffer.toString('utf8').replace(/^\ufeff/, '');
  return iconv.decode(buffer, encoding === 'cp866' ? 'cp866' : 'win1251');
}

/** The file starts with the format's marker (after an optional BOM and blank lines). */
export function isBankExchange(text: string): boolean {
  return /^\ufeff?\s*1CClientBankExchange\s*(\r?\n|$)/.test(text);
}

const KNOWN_VERSIONS = new Set(['1.01', '1.02', '1.03']);

/**
 * Parses the key=value lines into the header, the account sections and the documents, with one
 * grammar for versions 1.01–1.03 (research §7.25). Tolerant like a bank's own reader: blank lines
 * anywhere, CRLF or LF, spaces around `=` and trailing spaces trimmed, the value split at the first
 * `=` only; a key repeated inside a section keeps its first value (warning); a section that is not
 * closed before the next one starts, or a file without КонецФайла, is closed with a warning.
 */
export function parseBankExchange(input: Uint8Array | string): ParsedExchange {
  const encoding = typeof input === 'string' ? null : exchangeEncoding(input);
  const text = typeof input === 'string' ? input.replace(/^\ufeff/, '') : decodeBankExchange(input);
  const lines = text.split(/\r?\n/).map((l, i) => ({ text: l.trim(), line: i + 1 })).filter((l) => l.text !== '');
  if (lines[0]?.text !== '1CClientBankExchange') throw new Error('not a 1CClientBankExchange file');
  const out: ParsedExchange = { header: {}, headerAll: {}, accounts: [], documents: [], documentLines: [], warnings: [], encoding };
  let current: Record<string, string> | null = null;
  let kind: 'account' | 'document' | null = null;
  let ended = false;
  const close = (line: number): void => {
    if (kind === 'document') out.warnings.push({ line, code: 'missing_end_document' });
    if (kind === 'account') out.warnings.push({ line, code: 'missing_end_account' });
    current = null;
    kind = null;
  };
  for (const { text: raw, line } of lines.slice(1)) {
    if (raw === 'КонецФайла') { if (kind) close(line); ended = true; break; }
    if (raw === 'СекцияРасчСчет') { if (kind) close(line); current = {}; kind = 'account'; out.accounts.push(current); continue; }
    if (raw === 'КонецРасчСчет' || raw === 'КонецДокумента') { current = null; kind = null; continue; }
    const eq = raw.indexOf('=');
    if (eq < 0) { out.warnings.push({ line, code: 'line_without_key', key: raw.slice(0, 40) }); continue; }
    const key = raw.slice(0, eq).trim();
    const value = raw.slice(eq + 1).trim();
    if (key === 'СекцияДокумент') {
      if (kind) close(line);
      const doc = { _type: value } as Record<string, string> & { _type: string };
      out.documents.push(doc);
      out.documentLines.push(line);
      current = doc;
      kind = 'document';
      continue;
    }
    if (current === null) {
      (out.headerAll[key] ??= []).push(value);
      if (!(key in out.header)) out.header[key] = value;
      continue;
    }
    const section: Record<string, string> = current;
    if (key in section) { out.warnings.push({ line, code: 'duplicate_key', key }); continue; }
    section[key] = value;
  }
  if (!ended) {
    const last = lines[lines.length - 1]?.line ?? 0;
    if (kind) close(last);
    out.warnings.push({ line: last, code: 'missing_end_file' });
  }
  const version = out.header['ВерсияФормата'];
  if (version !== undefined && !KNOWN_VERSIONS.has(version)) out.warnings.push({ line: 0, code: 'unknown_version', key: version.slice(0, 20) });
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
