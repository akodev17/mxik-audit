// The words bank statements use, in Russian, Uzbek Latin and Uzbek Cyrillic: column headers per
// role, and the texts of the rows that are not transactions (balances, totals, page footers).
// Sources: the header words of the pilot companies' statements quoted in
// docs/accounting-2026-10-23/integration-research.md §2 ("Excel bank statements seen in the field")
// plus their usual spelling variants. No real statement file is in the repository; every layout
// built from these words is unverified until one is. Pure; shared with the browser.
import type { BankRole } from '@tasnivo/contracts/modules/bank';

/** Header text → comparable key: lower case, ё as е, apostrophes and trailing punctuation dropped, single spaces. */
export function bankHeaderKey(header: string): string {
  return header
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[ʻʼ'`’‘]/g, '')
    .replace(/\s*\/\s*/g, '/')
    .replace(/[.:;,*]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Header words per role, most specific first. Keys are already bankHeaderKey()-normalised. */
export const ROLE_ALIASES: Record<BankRole, readonly string[]> = {
  date: ['дата операции', 'дата документа', 'дата проводки', 'дата платежа', 'дата', 'operatsiya sanasi', 'hujjat sanasi', 'sana', 'сана', 'date'],
  docNumber: ['номер документа', '№ документа', '№ док', '№док', 'номер док', 'н/д', 'hujjat raqami', 'hujjat №', '№ hujjat', 'ҳужжат рақами', 'ҳужжат №', 'doc no', 'document no'],
  counterpartyName: [
    'наименование плательщика/получателя', 'наименование получателя/плательщика', 'плательщик/получатель', 'получатель/плательщик',
    'наименование корреспондента', 'наименование контрагента', 'корреспондент наименование', 'контрагент наименование', 'корреспондент', 'контрагент',
    'tolovchi/qabul qiluvchi', 'qabul qiluvchi/tolovchi', 'kontragent nomi', 'kontragent', 'korrespondent', 'контрагент номи', 'counterparty',
  ],
  inn: ['инн/пинфл', 'инн корреспондента', 'инн контрагента', 'инн', 'stir/jshshir', 'kontragent stiri', 'stir', 'стир', 'inn', 'tin'],
  account: [
    'счет корреспондента', 'счет контрагента', 'расчетный счет', 'корреспондент счет', 'счет', 'р/с',
    'kontragent hisob raqami', 'hisob raqami', 'ҳисоб рақами', 'hisob', 'account',
  ],
  mfo: ['мфо корреспондента', 'мфо банка', 'мфо', 'код банка', 'bank kodi', 'mfo', 'банк коди'],
  debit: ['обороты по дебету', 'оборот по дебету', 'сумма по дебету', 'дебет оборот', 'дебет', 'debet aylanma', 'debet', 'расход', 'списание', 'chiqim', 'чиқим', 'debit'],
  credit: ['обороты по кредиту', 'оборот по кредиту', 'сумма по кредиту', 'кредит оборот', 'кредит', 'kredit aylanma', 'kredit', 'приход', 'поступление', 'kirim', 'кирим', 'credit'],
  amount: ['сумма операции', 'сумма платежа', 'сумма документа', 'сумма', 'tolov summasi', 'summa', 'amount'],
  direction: ['дебет/кредит', 'debet/kredit', 'д/к', 'дт/кт', 'приход/расход', 'kirim/chiqim', 'тип операции', 'направление', 'yonalish', 'operatsiya turi', 'direction'],
  purpose: [
    'назначение платежа', 'назначение', 'детали платежа', 'содержание операции', 'описание',
    'tolov maqsadi', 'тўлов мақсади', 'тулов максади', 'maqsad', 'mazmuni', 'izoh', 'purpose', 'description',
  ],
  reference: ['id транзакции', 'id операции', 'референс', 'уникальный номер', 'идентификатор', 'tranzaksiya id', 'reference', 'ref'],
  currency: ['валюта', 'valyuta', 'валюта операции', 'currency'],
};

/** An amount column is never one whose header names a direction ("Сумма по дебету"). */
const DIRECTION_WORDS = /дебет|кредит|debet|kredit|приход|расход|kirim|chiqim|кирим|чиқим/u;

/**
 * How well a header key names a role: 3 = an alias exactly, 2 = an alias as whole words, 1 = an
 * alias of 5+ letters inside a word. 0 = not this role.
 */
export function aliasScore(key: string, alias: string): number {
  if (key === alias) return 3;
  if (` ${key} `.includes(` ${alias} `)) return 2;
  if (alias.length >= 5 && !alias.includes(' ') && key.includes(alias)) return 1;
  return 0;
}

export type ColumnCandidate = { column: number; role: BankRole; score: number; rank: number };

/** Every (column, role) pair a header could be, with its score and the alias's rank (lower = more specific). */
export function columnCandidates(headers: readonly string[], aliases: Partial<Record<BankRole, readonly string[]>> = ROLE_ALIASES): ColumnCandidate[] {
  const out: ColumnCandidate[] = [];
  headers.forEach((header, column) => {
    const key = bankHeaderKey(header);
    if (key === '') return;
    for (const [role, list] of Object.entries(aliases) as [BankRole, readonly string[]][]) {
      if (role === 'amount' && DIRECTION_WORDS.test(key)) continue;
      let best = 0;
      let rank = list.length;
      list.forEach((alias, i) => {
        const score = aliasScore(key, alias);
        if (score > best) { best = score; rank = i; }
      });
      if (best > 0) out.push({ column, role, score: best, rank });
    }
  });
  return out;
}

/**
 * Role → column, each column and each role used once: the strongest matches first (an exact
 * "Дебет/Кредит" is the direction flag before "Кредит" inside it can be the credit column).
 */
export function resolveColumns(headers: readonly string[], aliases: Partial<Record<BankRole, readonly string[]>> = ROLE_ALIASES): Partial<Record<BankRole, number>> {
  const candidates = columnCandidates(headers, aliases).sort((a, b) => b.score - a.score || a.rank - b.rank || a.column - b.column);
  const usedColumns = new Set<number>();
  const out: Partial<Record<BankRole, number>> = {};
  for (const c of candidates) {
    if (usedColumns.has(c.column) || out[c.role] !== undefined) continue;
    out[c.role] = c.column;
    usedColumns.add(c.column);
  }
  return out;
}

/** How many cells of a row read as statement headers (whole-word or exact): finds the header row under the titles. */
export function headerScore(row: readonly string[]): number {
  const roles = new Set<BankRole>();
  for (const c of columnCandidates(row)) if (c.score >= 2) roles.add(c.role);
  return roles.size;
}

// ── Rows that are not transactions ─────────────────────────────────────────────────────────

export type NoiseKind = 'opening_balance' | 'closing_balance' | 'balance' | 'totals' | 'footer';

/** Checked in this order: a closing balance row also says "остаток", a totals row may say "обороты". */
export const NOISE: readonly { kind: NoiseKind; pattern: RegExp }[] = [
  { kind: 'opening_balance', pattern: /входящ\S* (остаток|сальдо)|остаток на начало|сальдо на начало|начальн\S* (остаток|сальдо)|остаток входящий|kirish qoldig|boshlang\S* qoldi|davr boshi\S* qoldi|кириш қолдиғ|бошланғич қолдиқ/u },
  { kind: 'closing_balance', pattern: /исходящ\S* (остаток|сальдо)|остаток на конец|сальдо на конец|конечн\S* (остаток|сальдо)|остаток исходящий|chiqish qoldig|yakuniy qoldi|davr oxiri\S* qoldi|oxirgi qoldi|чиқиш қолдиғ|якуний қолдиқ/u },
  { kind: 'totals', pattern: /(^|\s)(итого|всего|обороты|оборот за|итог|jami|жами|yakun|aylanma|total)/u },
  { kind: 'balance', pattern: /остаток|сальдо|qoldiq|қолдиқ|balance/u },
  { kind: 'footer', pattern: /страница|стр\. ?\d|sahifa|page \d|подпись|главный бухгалтер|руководитель|исполнитель|м\.п\.|bosh hisobchi|imzo|распечатан|сформирован|chop etil|бош ҳисобчи/u },
];

export function noiseKind(text: string): NoiseKind | null {
  const lower = text.toLowerCase().replace(/ё/g, 'е').replace(/[ʻʼ'`’‘]/g, '');
  for (const n of NOISE) if (n.pattern.test(lower)) return n.kind;
  return null;
}

// ── Title rows above the header ────────────────────────────────────────────────────────────

export const TITLE = {
  account: /сч[её]т|hisob|ҳисоб|р\/с|account/iu,
  inn: /инн|stir|стир|пинфл|jshshir/iu,
  owner: /клиент|владелец|наименование (организации|клиента)|организация|mijoz|korxona|tashkilot|мижоз|корхона/iu,
  period: /период|с \d|davr|давр|выписк|ko.chirma|кўчирма|за \d/iu,
  currency: /валют|valyuta|currency/iu,
  bank: /банк|bank/iu,
} as const;

/** Currency words → ISO code. */
export const CURRENCY_WORDS: readonly [RegExp, string][] = [
  [/\buzs\b|сум|сўм|so.m\b/iu, 'UZS'],
  [/\busd\b|доллар|dollar/iu, 'USD'],
  [/\beur\b|евро|evro|euro/iu, 'EUR'],
  [/\brub\b|рубл|rubl/iu, 'RUB'],
];
