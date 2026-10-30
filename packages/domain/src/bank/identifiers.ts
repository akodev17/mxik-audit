// ИНН / ПИНФЛ, settlement accounts, МФО, counterparty names and debit/credit flags as statements
// write them. Pure; shared with the browser.

export type IdRead = { value: string | null; invalid: boolean; placeholder: boolean };

const NONE: IdRead = { value: null, invalid: false, placeholder: false };
/** A number cell written with its decimal part ("444.0", "302345678,0") is the whole number: the dot is not a separator. */
const wholeNumber = (raw: string): string => raw.trim().replace(/^(\d+)[.,]0+$/, '$1');
const digits = (raw: string): string => raw.replace(/[\s\u00a0\-–_.]/g, '');

/** 9-digit ИНН or 14-digit ПИНФЛ; all zeros (the banks' "unknown") reads as no ИНН. */
export function readInn(raw: string | null | undefined): IdRead {
  const text = digits(wholeNumber(raw ?? ''));
  if (text === '') return NONE;
  if (/^0+$/.test(text)) return { value: null, invalid: false, placeholder: true };
  if (/^(\d{9}|\d{14})$/.test(text)) return { value: text, invalid: false, placeholder: false };
  return { value: null, invalid: true, placeholder: false };
}

/** 20-digit Uzbek settlement account; all zeros reads as no account. */
export function readAccount(raw: string | null | undefined): IdRead {
  const text = digits(raw ?? '');
  if (text === '') return NONE;
  if (/^0+$/.test(text)) return { value: null, invalid: false, placeholder: true };
  if (/^\d{20}$/.test(text)) return { value: text, invalid: false, placeholder: false };
  return { value: null, invalid: true, placeholder: false };
}

/** 5-digit МФО. Excel drops leading zeros of a number cell ("00014" → 14), so 1–4 digits are padded back. */
export function readMfo(raw: string | null | undefined): IdRead {
  const text = digits(wholeNumber(raw ?? ''));
  if (text === '') return NONE;
  if (/^0+$/.test(text)) return { value: null, invalid: false, placeholder: true };
  if (/^\d{1,5}$/.test(text)) return { value: text.padStart(5, '0'), invalid: false, placeholder: false };
  return { value: null, invalid: true, placeholder: false };
}

/** The currency an Uzbek account is kept in: digits 6–8 of the 20 (000 = so'm), for the codes we know. */
const ACCOUNT_CURRENCY: Record<string, string> = { '000': 'UZS', '840': 'USD', '978': 'EUR', '643': 'RUB', '156': 'CNY', '398': 'KZT' };
export const accountCurrency = (account: string | null): string | null => (account && /^\d{20}$/.test(account) ? ACCOUNT_CURRENCY[account.slice(5, 8)] ?? null : null);

/** Legal-form words that do not tell two counterparties apart. */
const LEGAL_FORMS = new Set([
  'ооо', 'оао', 'зао', 'ао', 'пао', 'чп', 'ип', 'ук', 'гуп', 'сп', 'фх', 'дх', 'мчж', 'хк', 'атб', 'акб', 'жшж', 'ятт', 'хт', 'ок',
  'mchj', 'xk', 'aj', 'yatt', 'ok', 'xt', 'qk', 'atb', 'llc', 'ltd', 'jsc', 'fx', 'dx', 'mmj', 'ojsc',
]);

/** Lower case, quotes and punctuation dropped, legal forms dropped: what two spellings of one name share. */
export function normalizeName(name: string | null | undefined): string {
  return (name ?? '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[ʻʼ'`’‘]/g, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w !== '' && !LEGAL_FORMS.has(w))
    .join(' ');
}

const DEBIT_FLAGS = new Set(['д', 'дт', 'дб', 'дебет', 'd', 'dt', 'db', 'debit', 'debet', 'расход', 'списание', 'chiqim', 'чиқим', 'out', '-']);
const CREDIT_FLAGS = new Set(['к', 'кт', 'кр', 'кредит', 'c', 'k', 'ct', 'cr', 'kt', 'credit', 'kredit', 'приход', 'поступление', 'kirim', 'кирим', 'in', '+']);

/** A debit/credit flag cell → direction; null when the cell says something else. */
export function readDirectionFlag(raw: string | null | undefined): 'debit' | 'credit' | null {
  const text = (raw ?? '').trim().toLowerCase().replace(/[.:]$/, '');
  if (DEBIT_FLAGS.has(text)) return 'debit';
  if (CREDIT_FLAGS.has(text)) return 'credit';
  return null;
}
