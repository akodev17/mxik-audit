import { SAMPLE_REPORT } from '@/lib/sample-report.generated';

export const nf = new Intl.NumberFormat('uz-UZ');

/* Every figure on this page is measured, not estimated. Sources are in
   docs/gate0-report.md, which names the npm script that reproduces each one.
   Nothing here may become a round number because it reads better.

   Deliberately NOT on this page: the current 66.7% / 83.3% matching accuracy.
   It is measured over 12 of 30 golden cases with the LLM reranker off and a
   non-semantic embedding stand-in, so it is internal and incomplete. Also not
   here: the old "99% strict unit binding" figure, which Gate 0 disproved. */
export const CATALOG_CODES = 438_925;      // gate0 §1 — codes in the official export
export const SUBPOSITIONS = 10_215;        // gate0 §9 — subposition nodes
export const CANONICAL_UNITS = 168;        // gate0 §4 — parsed canonical unit names
export const MARKED_CODES = 124_169;       // gate0 §5 — confirmed digitally marked
export const STRICT_UNIT_PCT = '87,8%';    // gate0 §4 — 385,414 of 438,925
export const AUTOMATED_TESTS = 198;        // npm test — keep in step with the suite
export const SNAPSHOT = '20.08.2026';

/* ------------------------------------------------------------- diagram source

   Nothing on this page is a screenshot of the application, and nothing is an
   invented number either: the diagrams are built from HTML and driven by the
   frozen sample audit in src/lib/sample-report.generated.ts. So the product
   names, the 17-digit codes, the finding types and the totals in every figure
   below are what the pipeline actually produced on the demo catalogue.

   That rules out the placeholder codes a concept diagram would normally use
   (12345678901234567): to this audience a made-up MXIK reads as carelessness,
   and we have real ones to hand. */

const rowOfType = (type: string) =>
  SAMPLE_REPORT.rows.find((r) => r.type === type) ?? SAMPLE_REPORT.rows[0];

/** The MISMATCH case: a real code that is valid but describes another product —
 *  the finding that is impossible to spot by eye, so it carries the walkthrough. */
export const FOCUS_ROW = rowOfType('MISMATCH');

export const CLEAN_ROWS = SAMPLE_REPORT.totalRows - SAMPLE_REPORT.riskyRows;

/* ------------------------------------------------------------------ evidence */

/* Live queries against the portal's own search on the snapshot date; gate0 §7.
   These two are the headline pair because they need no explanation: the same
   product, spelled two ways, answered usefully once and uselessly the other
   time. The reader recognises both products instantly. */
export const HEADLINE_EVIDENCE = [
  {
    query: 'Coca-Cola 1.5L',
    queryNote: 'doʻkon katalogida yozilganidek',
    result: 'Paracetamol',
    resultNote: 'birinchi natija — «Цефекон Д»',
    contrastQuery: 'Coca Cola',
    contrastResult: '68 natija, birinchisi toʻgʻri',
    lesson: 'Nomdagi qadoq oʻlchami qidiruvni butunlay buzadi.',
  },
  {
    query: "no'xat",
    queryNote: 'klaviaturadagi oddiy apostrof',
    result: 'akril polimer dispersiyasi',
    resultNote: 'yagona natija, va u notoʻgʻri',
    contrastQuery: 'noʻxat',
    contrastResult: '105 natija',
    lesson: 'Bitta belgi — apostrof — javobni almashtirib yuboradi.',
  },
] as const;

export const EVIDENCE_ROWS = [
  { query: 'цемент портланд', note: 'ikkita toʻgʻri ruscha soʻz', result: '0 natija', bad: true },
  { query: 'tibbiy xizmat', note: 'toʻgʻri oʻzbek lotin yozuvi', result: '0 natija', bad: true },
  {
    query: 'тиббий хизмат',
    note: 'xuddi shu soʻrov, kirill yozuvida',
    result: '297 natija — yuqorisida elektr choynak va tagliklar',
    bad: true,
  },
] as const;

/* --------------------------------------------------------------- consequences */

/* VERIFICATION STATUS — READ BEFORE EDITING.
   Only the first item has a primary source: VMQ No. 595 of 22.09.2021 was
   checked against lex.uz and it backs the EHF restriction. The other three are
   stated as mechanism or practice, with no article number, and each says so in
   the copy the reader sees. `verified: false` means: a tax adviser must confirm
   it against a primary source before it may be worded as settled law. Do not
   attach the VMQ 595 citation to the other three — it does not cover them. */
export const CONSEQUENCES = [
  {
    title: 'EHF chiqarib boʻlmaydi',
    body:
      'Tovar milliy katalogda topilmasa, elektron hisobvaraq-fakturani '
      + 'rasmiylashtirish cheklanadi. Bu jarima emas — savdoning toʻxtashi.',
    cite: 'VMQ № 595, 22.09.2021',
    citeHref: 'https://lex.uz/docs/5650010',
    citeNote: 'lex.uz bilan tekshirilgan',
    verified: true,
  },
  {
    title: 'Xaridorning QQS hisobi',
    body:
      'Kirish QQSi mos keladigan EHF asosida hisobga olinadi. Kod notoʻgʻri '
      + 'boʻlsa, savol avval mijozingizda paydo boʻladi — keyin sizda.',
    cite: null,
    citeHref: null,
    citeNote: 'Amaliyot tavsifi. Aniq moddani soliq maslahatchingiz bilan tasdiqlang',
    verified: false,
  },
  {
    title: 'Razriv → tushuntirish soʻrovi',
    body:
      'Sizning EHF bilan kontragent EHF orasidagi moslik buzilsa, tizim buni '
      + 'belgilaydi. Keyingi qadam — kameral tekshiruv doirasidagi soʻrov.',
    cite: null,
    citeHref: null,
    citeNote: 'Maʼmuriy amaliyot: aniq modda emas, tizim mexanizmi',
    verified: false,
  },
  {
    title: 'Jarima',
    body:
      'Hisobvaraq-fakturani notoʻgʻri rasmiylashtirish uchun javobgarlik '
      + 'belgilangan. Aniq modda va miqdor holatga bogʻliq.',
    cite: null,
    citeHref: null,
    citeNote: 'Moddani ataylab keltirmayapmiz: oshirib koʻrsatishdan koʻra aniqlik muhim',
    verified: false,
  },
] as const;

/* --------------------------------------------------------------- the findings */

export const FINDINGS = [
  { key: 'MISSING' as const, label: 'Kod yoʻq', body: 'Qatorda MXIK kodi koʻrsatilmagan.' },
  {
    key: 'NOT_FOUND' as const,
    label: 'Bazada topilmadi',
    body: 'Kod yozilgan, lekin tasniflagichda bunday kod yoʻq.',
  },
  {
    key: 'MISMATCH' as const,
    label: 'Nomga mos emas',
    body: 'Kod haqiqiy, lekin u boshqa tovarni bildiradi.',
  },
  {
    key: 'UNIT_CONFLICT' as const,
    label: 'Oʻlchov birligi mos emas',
    body: 'Kodga qatʼiy biriktirilgan birlik katalogdagidan farq qiladi.',
  },
] as const;

/* The four checks, in the order the audit runs them — the content of the
   "Tekshiring" diagram. Only ARCHIVED is missing, and deliberately: Gate 0
   established that no accessible source exposes deprecation status, so it is
   not claimed here. */
export const CHECKS = [
  { q: 'Qatorda MXIK kodi bormi?', fail: 'Kod yoʻq' },
  { q: 'Kod tasniflagichda bormi?', fail: 'Bazada topilmadi' },
  { q: 'Kod tovar nomiga mos keladimi?', fail: 'Nomga mos emas' },
  { q: 'Oʻlchov birligi kodga mos keladimi?', fail: 'Oʻlchov birligi mos emas' },
] as const;

/* Column headers the importer recognises. Both scripts appear in real
   catalogues — Gate 0 found 23% of the official Latin export carries Cyrillic
   inside otherwise Latin strings, and customer files are worse. */
export const COLUMN_MAP = [
  { from: 'Наименование товара', to: 'Tovar nomi' },
  { from: 'Штрих-код', to: 'Shtrix kod' },
  { from: 'MXIK kodi', to: 'MXIK kodi' },
  { from: 'Ед. изм.', to: 'Oʻlchov birligi' },
] as const;

export const DELIVERABLES = [
  {
    title: 'Risk hisoboti',
    body: 'Qaysi pozitsiyalar muammoli ekanini va nimasi notoʻgʻri ekanini koʻrasiz.',
  },
  {
    title: 'Tavsiya etilgan MXIK',
    body: 'Mos kelishi mumkin boʻlgan kod, tasniflagichdagi oʻrni va sababi.',
  },
  {
    title: 'Tekshiruv tarixi',
    body: 'Qaysi qaror qachon va kim tomonidan qabul qilinganini koʻrasiz.',
  },
  {
    title: 'Excel eksport',
    body: 'Tasdiqlangan oʻzgarishlarni katalogingizga qaytarib olasiz.',
  },
] as const;

export const PRICING = [
  { rows: '500 SKU gacha', price: '700 000' },
  { rows: '2 000 SKU gacha', price: '1 500 000' },
  { rows: '10 000 SKU gacha', price: '4 000 000' },
] as const;

export const TYPE_LABEL: Record<string, string> = {
  MISSING: 'Kod yoʻq',
  NOT_FOUND: 'Bazada topilmadi',
  MISMATCH: 'Nomga mos emas',
  UNIT_CONFLICT: 'Oʻlchov birligi',
};
