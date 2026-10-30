// Uzbek counterparty requisites as 1C «Бухгалтерия для Узбекистана» keeps them (research note onec
// §1.4, checklist §8.13–16): ИНН 9 digits (legal entities), ПИНФЛ 14 (individuals), the VAT
// registration code 12, a settlement account 20 (27 for a budget organisation's «Бюджетный ЛС»,
// 3.0.46) and the bank's МФО 5 with its leading zeros. Values arrive from Excel, where a number
// cell loses those zeros: an МФО of 1–5 digits is padded back, everything else must already have
// its length. Pure.

export type CounterpartyKind = 'legal' | 'individual' | 'nonresident';

const digits = (value: string | null | undefined): string => (value ?? '').replace(/\D/g, '');

/** 9 digits. */
export const validInn = (v: string): boolean => /^\d{9}$/.test(v);
/** 14 digits. */
export const validPinfl = (v: string): boolean => /^\d{14}$/.test(v);
/** 12 digits. */
export const validVatCode = (v: string): boolean => /^\d{12}$/.test(v);
/** 20 digits; 27 only for a budget organisation's personal account. */
export const validAccount = (v: string, budget = false): boolean => /^\d{20}$/.test(v) || (budget && /^\d{27}$/.test(v));

/** An МФО as printed or as Excel left it (`401` → `00401`); null when it cannot be one. */
export function mfoOf(value: string | null | undefined): string | null {
  const d = digits(value);
  return d.length >= 1 && d.length <= 5 ? d.padStart(5, '0') : null;
}

/** «Вид контрагента» and the like, as words: Юридическое лицо / Физическое лицо / ИП / нерезидент, uz and ru. */
export function kindOf(value: string | null | undefined): CounterpartyKind | null {
  const v = (value ?? '').toLowerCase().replace(/ё/g, 'е');
  if (!v.trim()) return null;
  if (/нерезидент|иностран|norezident|xorijiy|non-?resident|foreign/.test(v)) return 'nonresident';
  // `\b` does not see Cyrillic letters as word characters: «ИП» is matched as a word by hand.
  if (/физ|(?:^|[^а-я])ип(?:[^а-я]|$)|индивидуальн|jismoniy|yatt|individual/.test(v)) return 'individual';
  if (/юр|организац|yuridik|legal|company/.test(v)) return 'legal';
  return null;
}

export type RequisiteError = 'inn_invalid' | 'pinfl_invalid' | 'inn_required' | 'vat_code_invalid' | 'account_invalid' | 'mfo_invalid' | 'branch_invalid';

export type Requisites = {
  /** ИНН, or the ПИНФЛ of an individual: what the counterparty's `inn` column holds. */
  inn: string | null;
  kind: CounterpartyKind | null;
  vatCode: string | null;
  account: string | null;
  mfo: string | null;
  branchCode: string | null;
};

/**
 * Checks one counterparty's requisites. `fatal` keeps the row out (an identifier that is not one);
 * `warnings` drop only that field. A row with neither ИНН nor ПИНФЛ is allowed only for a
 * non-resident, or when the file does not say what kind the counterparty is.
 */
export function checkRequisites(input: {
  inn?: string | null; pinfl?: string | null; kind?: CounterpartyKind | null; vatCode?: string | null; account?: string | null; mfo?: string | null;
  branchCode?: string | null; budget?: boolean;
}): { value: Requisites; fatal: RequisiteError | null; warnings: RequisiteError[] } {
  const warnings: RequisiteError[] = [];
  const innText = digits(input.inn);
  const pinflText = digits(input.pinfl);
  let kind = input.kind ?? null;
  let inn: string | null = null;
  let fatal: RequisiteError | null = null;
  // One «ИНН/ПИНФЛ» column holds either; a separate ПИНФЛ column marks an individual.
  if (innText) {
    if (validInn(innText)) inn = innText;
    else if (validPinfl(innText)) { inn = innText; kind ??= 'individual'; }
    else fatal = 'inn_invalid';
  }
  if (!inn && !fatal && pinflText) {
    if (validPinfl(pinflText)) { inn = pinflText; kind ??= 'individual'; }
    else fatal = 'pinfl_invalid';
  }
  if (inn && kind === null) kind = inn.length === 9 ? 'legal' : 'individual';
  if (!inn && !fatal && (kind === 'legal' || kind === 'individual')) fatal = 'inn_required';
  const vat = digits(input.vatCode);
  const vatCode = vat ? (validVatCode(vat) ? vat : (warnings.push('vat_code_invalid'), null)) : null;
  const acc = digits(input.account);
  const account = acc ? (validAccount(acc, input.budget ?? false) ? acc : (warnings.push('account_invalid'), null)) : null;
  const mfoRaw = digits(input.mfo);
  const mfo = mfoRaw ? mfoOf(mfoRaw) ?? (warnings.push('mfo_invalid'), null) : null;
  const branch = (input.branchCode ?? '').trim();
  const branchCode = branch ? (/^[\dA-Za-z-]{1,10}$/.test(branch) ? branch :(warnings.push('branch_invalid'), null)) : null;
  return { value: { inn, kind, vatCode, account, mfo, branchCode }, fatal, warnings };
}
