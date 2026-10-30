// The built-in statement layouts. No real bank statement is in the repository (tmp/found-catalogs
// holds product catalogues only), so every layout here is generic — built from the header
// vocabulary of the pilot companies' statements quoted in
// docs/accounting-2026-10-23/integration-research.md §2 — and `verified: false` until a real file
// of that layout is read and its balance reconciles. A bank-specific layout is added here (with
// its fixture) once the owner provides that bank's export. The 30 Oct 2026 research added layouts
// built from published documents (CBU п.121, the Colvir manual's statement screen, iBank2's CSV
// guide, the 1C exchange standard, ASBT's document export): still unverified, because no Uzbek
// bank's own Excel statement is public (fixtures/SOURCES.md).
import { bankHeaderKey } from '../vocabulary.js';
import type { BankFormatDef } from './types.js';

const RESEARCH = 'docs/accounting-2026-10-23/integration-research.md §2 (header words of pilot statements); no real file yet';
const P121 = 'CBU Instruction reg. 1834 п.121 (lex.uz/ru/docs/1370900): the 22 requisites of a лицевой счёт; column words are ours, no bank publishes its header (bank research §2.4); see bank/fixtures/SOURCES.md';
const COLVIR = 'Aloqabank Colvir manual §5.2.2 Рис. 26 (aloqabank.uz, RESEARCH.md §2.2): on-screen statement columns; the Excel export itself not published; see bank/fixtures/SOURCES.md';
const IBANK2 = 'BIFIT iBank2 Format Guide p.132 (ibank.ccb.ru): statement CSV fields and example; no Uzbek bank confirmed on iBank2; see bank/fixtures/SOURCES.md';
const EXCHANGE = '1C standard 1CClientBankExchange 1.02/1.03 (v8.1c.ru, its.1c.ru), read through documents.ts; see bank/fixtures/SOURCES.md';
const ASBT = 'ASBT 4.0 help «Экспорт документов» (ibank1.ipotekabank.uz): user-ordered payment-document fields, any delimiter or fixed width; see bank/fixtures/SOURCES.md';

/** The columns of the statement table documents.ts builds from payment documents: iBank2's statement CSV names, then direction-less amount, code and kind. */
export const DOCUMENT_HEADERS = [
  'Счет', 'Дата документа', 'Номер документа', 'Дата операции', 'Дебет', 'Кредит', 'Сумма без направления',
  'Корреспондент', 'ИНН Корреспондента', 'Счет корреспондента', 'Бик банка', 'Название банка', 'Примечание',
  'Код назначения', 'Вид документа',
] as const;

/** That table read by every column's exact name. */
const DOCUMENT_COLUMNS: BankFormatDef['columns'] = Object.fromEntries(([
  ['ownAccount', 0], ['date', 1], ['docNumber', 2], ['valueDate', 3], ['debit', 4], ['credit', 5], ['amount', 6], ['counterpartyName', 7],
  ['inn', 8], ['account', 9], ['mfo', 10], ['purpose', 12], ['purposeCode', 13],
] as const).map(([role, i]) => [role, [bankHeaderKey(DOCUMENT_HEADERS[i])]]));

export const BUILT_IN_FORMATS: readonly BankFormatDef[] = [
  {
    id: 'generic_ru_debit_credit',
    name: 'Выписка (RU): дебет и кредит отдельными колонками',
    bankName: null,
    verified: false,
    source: RESEARCH,
    columns: {
      date: ['дата', 'дата операции', 'дата документа', 'дата проводки'],
      docNumber: ['№ док', '№ документа', 'номер документа', 'номер док'],
      counterpartyName: ['корреспондент', 'контрагент', 'наименование корреспондента', 'корреспондент наименование', 'наименование плательщика/получателя'],
      inn: ['инн', 'инн корреспондента', 'корреспондент инн'],
      account: ['счет', 'счет корреспондента', 'корреспондент счет', 'расчетный счет'],
      mfo: ['мфо', 'корреспондент мфо', 'мфо банка'],
      debit: ['дебет', 'обороты по дебету', 'сумма дебет', 'сумма по дебету'],
      credit: ['кредит', 'обороты по кредиту', 'сумма кредит', 'сумма по кредиту'],
      purpose: ['назначение платежа', 'назначение'],
    },
    required: ['date', 'debit', 'credit'],
    conventions: { dateOrder: 'dmy', decimal: 'auto', direction: 'columns', negativeIs: 'debit', currency: 'UZS' },
    dropRows: [/обороты? за (день|период|месяц)/u],
  },
  {
    id: 'generic_uz_debit_credit',
    name: "Ko'chirma (UZ lotin): debet va kredit alohida ustunlarda",
    bankName: null,
    verified: false,
    source: RESEARCH,
    columns: {
      date: ['sana', 'operatsiya sanasi', 'hujjat sanasi'],
      docNumber: ['hujjat raqami', 'hujjat №', '№ hujjat'],
      counterpartyName: ['kontragent', 'kontragent nomi', 'korrespondent', 'tolovchi/qabul qiluvchi'],
      inn: ['stir', 'kontragent stiri', 'stir/jshshir'],
      account: ['hisob raqami', 'kontragent hisob raqami'],
      mfo: ['mfo', 'bank kodi'],
      debit: ['debet', 'debet aylanma', 'chiqim'],
      credit: ['kredit', 'kredit aylanma', 'kirim'],
      purpose: ['tolov maqsadi', 'maqsad', 'izoh'],
    },
    required: ['date', 'debit', 'credit'],
    conventions: { dateOrder: 'dmy', decimal: 'auto', direction: 'columns', negativeIs: 'debit', currency: 'UZS' },
    dropRows: [/kunlik aylanma|davr aylanmasi/u],
  },
  {
    id: 'generic_amount_direction',
    name: 'Выписка: одна сумма + признак Дебет/Кредит (или сумма со знаком)',
    bankName: null,
    verified: false,
    source: RESEARCH,
    columns: {
      date: ['дата', 'дата операции', 'дата документа', 'sana'],
      docNumber: ['номер документа', '№ документа', '№ док', 'hujjat raqami'],
      counterpartyName: ['наименование плательщика/получателя', 'плательщик/получатель', 'контрагент', 'корреспондент', 'kontragent'],
      inn: ['инн', 'инн/пинфл', 'stir'],
      account: ['расчетный счет', 'счет', 'hisob raqami'],
      mfo: ['мфо', 'mfo'],
      amount: ['сумма', 'сумма операции', 'сумма платежа', 'summa'],
      direction: ['дебет/кредит', 'д/к', 'дт/кт', 'debet/kredit', 'приход/расход', 'kirim/chiqim', 'тип операции'],
      purpose: ['назначение платежа', 'назначение', 'tolov maqsadi'],
      reference: ['референс', 'id транзакции', 'id операции', 'reference'],
      currency: ['валюта', 'valyuta'],
    },
    required: ['date', 'amount'],
    // `flag` when the file has a Дебет/Кредит column, otherwise the amount's sign (detectFormat decides).
    conventions: { dateOrder: 'dmy', decimal: 'auto', direction: 'flag', negativeIs: 'debit', currency: 'UZS' },
    dropRows: [],
  },
  // ── Layouts from the 30 Oct research (tmp/real-docs/bank/RESEARCH.md; fixtures in ../fixtures/SOURCES.md) ──
  {
    id: 'cbu_p121',
    name: 'Выписка лицевого счёта по п.121 Инструкции ЦБ № 1834 (базовый профиль)',
    bankName: null,
    verified: false,
    source: P121,
    columns: {
      date: ['дата документа', 'дата', 'ҳужжат санаси', 'hujjat sanasi'],
      valueDate: ['дата проводки', 'дата обработки', 'ишлов бериш санаси'],
      docNumber: ['№ документа', 'номер документа', 'ҳужжат рақами', 'hujjat raqami'],
      mfo: ['мфо банка корреспондента', 'корреспондент мфо', 'код банка корреспондента', 'вакил банк коди', 'мфо'],
      account: ['счет корреспондента', 'корреспондент счет', 'корреспондирующий счет', 'корреспонденцияланувчи ҳисобварақ', 'корреспондент ҳисобварақ'],
      counterpartyName: ['наименование корреспондента', 'корреспондент наименование', 'корреспондент номи'],
      inn: ['инн корреспондента', 'корреспондент инн', 'инн', 'стир'],
      debit: ['обороты дебет', 'обороты по дебету', 'дебет', 'дебет бўйича айланма'],
      credit: ['обороты кредит', 'обороты по кредиту', 'кредит', 'кредит бўйича айланма'],
      purpose: ['назначение платежа', 'тўловнинг мақсади', 'тўлов мақсади'],
      purposeCode: ['код назначения', 'код назначения платежа', 'тўлов мақсади коди'],
    },
    required: ['date', 'debit', 'credit', 'mfo', 'account'],
    conventions: { dateOrder: 'dmy', decimal: 'auto', direction: 'columns', negativeIs: 'debit', currency: 'UZS' },
    dropRows: [],
  },
  {
    id: 'colvir_ib',
    name: 'Colvir «Интернет-банк для юридических лиц»: выписка по счёту',
    bankName: 'Aloqabank (Colvir)',
    verified: false,
    source: COLVIR,
    columns: {
      date: ['дата создания'],
      valueDate: ['дата валютирования'],
      docNumber: ['номер документа'],
      counterpartyName: ['корреспондент'],
      account: ['счет', 'корреспондент счет'],
      mfo: ['бик', 'бик банк'],
      debit: ['расход'],
      credit: ['приход'],
      purpose: ['назначение платежа', 'назначение'],
    },
    required: ['date', 'debit', 'credit', 'mfo'],
    conventions: { dateOrder: 'dmy', decimal: 'auto', direction: 'columns', negativeIs: 'debit', currency: 'UZS' },
    dropRows: [],
  },
  {
    id: 'ibank2_csv',
    name: 'iBank2: выписка в CSV (один файл по всем счетам)',
    bankName: null,
    verified: false,
    source: IBANK2,
    columns: {
      ownAccount: ['счет'],
      valueDate: ['дата операции'],
      date: ['дата документа'],
      docNumber: ['номер документа'],
      mfo: ['бик банка'],
      account: ['счет корреспондента'],
      counterpartyName: ['корреспондент'],
      debit: ['дебет'],
      credit: ['кредит'],
      purposeCode: ['код'],
      purpose: ['примечание'],
      inn: ['инн корреспондента'],
      reference: ['id докум', 'идентификатор документа'],
    },
    required: ['ownAccount', 'date', 'debit', 'credit'],
    conventions: { dateOrder: 'dmy', decimal: 'auto', direction: 'columns', negativeIs: 'debit', currency: 'UZS' },
    dropRows: [],
  },
  {
    id: 'onec_client_bank_exchange',
    name: '1CClientBankExchange (kl_to_1c.txt) банка',
    bankName: null,
    verified: false,
    source: EXCHANGE,
    columns: DOCUMENT_COLUMNS,
    required: ['ownAccount', 'date', 'debit', 'credit'],
    conventions: { dateOrder: 'dmy', decimal: 'dot', direction: 'columns', negativeIs: 'debit', currency: 'UZS' },
    dropRows: [],
    detect: false,
  },
  {
    id: 'payer_payee_documents',
    name: 'Экспорт платёжных документов (плательщик / получатель), ASBT',
    bankName: null,
    verified: false,
    source: ASBT,
    columns: DOCUMENT_COLUMNS,
    required: ['ownAccount', 'date', 'debit', 'credit'],
    conventions: { dateOrder: 'dmy', decimal: 'auto', direction: 'columns', negativeIs: 'debit', currency: 'UZS' },
    dropRows: [],
    detect: false,
  },
];
