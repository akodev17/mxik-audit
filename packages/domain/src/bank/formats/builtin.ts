// The built-in statement layouts. No real bank statement is in the repository (tmp/found-catalogs
// holds product catalogues only), so every layout here is generic — built from the header
// vocabulary of the pilot companies' statements quoted in
// docs/accounting-2026-10-23/integration-research.md §2 — and `verified: false` until a real file
// of that layout is read and its balance reconciles. A bank-specific layout is added here (with
// its fixture) once the owner provides that bank's export.
import type { BankFormatDef } from './types.js';

const RESEARCH = 'docs/accounting-2026-10-23/integration-research.md §2 (header words of pilot statements); no real file yet';

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
];
