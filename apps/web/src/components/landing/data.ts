import { fmtNumber } from '@tasnivo/i18n/format';
import { SAMPLE_REPORT } from '@tasnivo/domain/sample-report.generated';
import { LEAD_FILE_RETENTION_DAYS } from './config';

/** Whole numbers as the app writes them ("438 925"). Not Intl 'uz-UZ': browsers and Node
 *  disagree on its separators, which breaks hydration in a client component. */
export const nf = { format: (value: number): string => fmtNumber('uz', value) } as const;

/* Every figure on this page is measured, not estimated, and nothing here may
   become a round number because it reads better.

   The classifier facts are counted by scripts/make-sample-report.ts from the
   same database the sample audit ran against, so the page cannot quote one
   snapshot while auditing with another. What each one means is documented in
   docs/gate0-report.md (§1 codes, §4 strict units, §5 marking, §9 subpositions).

   Deliberately NOT on this page: the current 66.7% / 83.3% matching accuracy.
   It is measured over 12 of 30 golden cases with the LLM reranker off and a
   non-semantic embedding stand-in, so it is internal and incomplete. Also not
   here: the old "99% strict unit binding" figure, which Gate 0 disproved, and
   the size of the test suite — a developer metric, not a reason for an
   accountant to trust anything. */
const C = SAMPLE_REPORT.classifier;
export const CATALOG_CODES = C.codes;          // codes in the official export
export const SUBPOSITIONS = C.subpositions;    // subposition nodes, where a code is chosen
export const CANONICAL_UNITS = C.canonicalUnits; // parsed canonical unit names
export const MARKED_CODES = C.markedCodes;     // confirmed digitally marked
/** Share of codes with a strictly bound unit, one decimal, Uzbek decimal comma. */
export const STRICT_UNIT_PCT = `${((100 * C.strictUnitCodes) / C.codes).toFixed(1).replace('.', ',')}%`;
export const SNAPSHOT = C.snapshot;

/** The sample's download name, under public/demo/. Same value as SAMPLE_FILENAME
 *  in scripts/landing-sample/catalog.ts (a test holds them together); not
 *  imported from there because that module pulls in exceljs. */
export const SAMPLE_FILENAME = 'namuna-katalog.xlsx';

/* ------------------------------------------------------------- the sample

   Nothing on this page is a screenshot and nothing is an invented number: the
   workspace and the code anatomy are driven by the frozen sample audit in
   src/lib/sample-report.generated.ts, the demo's own catalogue run through the
   real pipeline. A made-up MXIK (12345678901234567) would read as carelessness
   to this audience, and we have real ones to hand.

   The sample's totals appear in ONE place only: the workspace at the top. */

/* ------------------------------------------------------------------ evidence

   What the portal's own search returns, re-run on PORTAL_CHECKED with
   `npm run check:portal-examples` (output: docs/portal-examples.json). The
   numbers drift — Coca-Cola 1.5L topped with Paracetamol on 20.08.2026 and
   with Ketoprofen on 15.10.2026 — so re-run the script before a demo and copy
   today's figures here with today's date. Three examples, no more.

   The framing is deliberate: the portal is the authoritative source and is
   fine for looking up one code. It is not built to check a catalogue in bulk,
   and these show why. We complement it; we do not attack it. */
export const PORTAL_CHECKED = '15.10.2026';

export const PORTAL_EXAMPLES = [
  {
    query: 'Coca-Cola 1.5L',
    note: 'doʻkon katalogida yozilganidek',
    result: 'Birinchi natija: dori vositasi (Ketoprofen)',
    contrast: { query: 'Coca Cola', result: '57 natija, birinchisi toʻgʻri' },
  },
  {
    query: "no'xat",
    note: 'klaviaturadagi oddiy apostrof bilan',
    result: '1 natija: akril polimer dispersiyasi',
    contrast: { query: 'noʻxat', result: '68 natija' },
  },
  {
    query: 'цемент портланд',
    note: 'ikkita toʻgʻri ruscha soʻz',
    result: '0 natija',
    contrast: null,
  },
] as const;

/* --------------------------------------------------------------- consequences */

/* VERIFICATION STATUS — READ BEFORE EDITING.

   Each source is attached only to the sentence it actually supports.

   EHF card, checked 15.10.2026:
   - VMQ No. 595 of 22.09.2021, p.6 «г» (lex.uz/docs/5650010): an automatic
     check, based on the national product catalogue, of whether the SUPPLIER
     has the goods; where it does not, issuing a sales invoice is restricted.
     It does not mention MXIK by name and does not say who it applies to today.
   - Tax Committee statement of 08.04.2026 (t.me/soliqnews/18626): today the
     restriction applies to TRADE companies — goods being sold are compared with
     their purchases by MXIK, and the invoice is blocked when they are not
     found. Production, construction and agriculture are excluded for now.
   So "trade companies" and "by MXIK" are cited to the statement, not to the
   decree.

   The QQS and razriv cards are stated as practice / mechanism with no article
   number, and say so in the copy. `verified: false` means a tax adviser must
   confirm it before it may be worded as settled law.

   The fine card has two versions; see FINE_CARD_223 below. */
export type Source = { label: string; href: string; note: string };

export type Consequence = {
  title: string;
  body: string;
  sources: readonly Source[];
  /** Shown when there is no source: what kind of statement this is. */
  note: string | null;
  verified: boolean;
};

const EHF_CARD: Consequence = {
  title: 'Savdoda EHF bloklanishi mumkin',
  body:
    'Savdo korxonasi sotayotgan tovar MXIK boʻyicha xaridlari orasida '
    + 'topilmasa, EHF rasmiylashtirish cheklanadi. Solishtirish kod boʻyicha '
    + 'boʻlgani uchun katalogdagi notoʻgʻri kod xarid bilan mos kelmay qolishi '
    + 'mumkin. Hozircha bu savdo korxonalariga qoʻllanadi.',
  sources: [
    {
      label: 'VMQ № 595, 22.09.2021, 6-band «g»',
      href: 'https://lex.uz/docs/5650010',
      note:
        'lex.uz bilan tekshirilgan: yetkazib beruvchida tovar mavjudligini '
        + 'avtomatik aniqlash, tovar boʻlmasa, EHFni cheklash',
    },
    {
      label: 'Soliq qoʻmitasi rasmiy munosabati, 08.04.2026',
      href: 'https://t.me/soliqnews/18626',
      note: 'savdo korxonalariga qoʻllanishi va MXIK boʻyicha solishtirish',
    },
  ],
  note: null,
  verified: true,
};

const FINE_CARD_GENERIC: Consequence = {
  title: 'Jarima',
  body:
    'Hisobvaraq-fakturani notoʻgʻri rasmiylashtirish uchun javobgarlik '
    + 'belgilangan. Aniq modda va miqdor holatga bogʻliq.',
  sources: [],
  note: 'Moddani ataylab keltirmayapmiz: oshirib koʻrsatishdan koʻra aniqlik muhim',
  verified: false,
};

/* Behind NEXT_PUBLIC_SHOW_LEGAL_223 (off by default). Wording follows Tax Code
   art. 223 part 5 as read on 15.10.2026 from a consolidated edition dated
   19.07.2026 (prg.kz). Not yet confirmed on lex.uz by a tax adviser — which is
   exactly what the flag waits for. */
const FINE_CARD_223: Consequence = {
  title: 'Jarima: sotuv qiymatining 1%',
  body:
    'Hisobvaraq-faktura yoki kassa chekida tovar nomenklaturasiga mos '
    + 'kelmaydigan identifikatsiya kodi koʻrsatilsa, shu hujjatdagi sotuv '
    + 'qiymatining 1% miqdorida jarima qoʻllanadi.',
  sources: [
    {
      label: 'Soliq kodeksi, 223-modda, 5-qism',
      href: 'https://lex.uz/docs/4674902',
      note: 'soliq maslahatchisi bilan tasdiqlangan',
    },
  ],
  note: null,
  verified: true,
};

export function consequences(showLegal223: boolean): readonly Consequence[] {
  return [
    EHF_CARD,
    {
      title: 'Xaridorning QQS hisobi',
      body:
        'Kirish QQSi mos keladigan EHF asosida hisobga olinadi. Kod notoʻgʻri '
        + 'boʻlsa, savol avval mijozingizda paydo boʻladi, keyin sizda.',
      sources: [],
      note: 'Amaliyot tavsifi. Aniq moddani soliq maslahatchingiz bilan tasdiqlang',
      verified: false,
    },
    {
      title: 'Razriv → tushuntirish soʻrovi',
      body:
        'Sizning EHF bilan kontragent EHF orasidagi moslik buzilsa, tizim buni '
        + 'belgilaydi. Keyingi qadam: kameral tekshiruv doirasidagi soʻrov.',
      sources: [],
      note: 'Maʼmuriy amaliyot: aniq modda emas, tizim mexanizmi',
      verified: false,
    },
    showLegal223 ? FINE_CARD_223 : FINE_CARD_GENERIC,
  ];
}

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

/* ------------------------------------------------------------------ data flow

   One wording, used everywhere the page talks about the customer's file, so
   two sections can never contradict each other again. Checked against code:

   - Stored: the whole file. Lead uploads keep the bytes (Lead.fileData,
     POST /api/lead, packages/domain/src/lead-submit.ts); app uploads keep every original cell
     (CatalogItem.attrs.original) so Export can rebuild the file.
   - Read by the audit: name, barcode, MXIK, unit (src/lib/audit-runner.ts).
     Price is stored but not used.
   - Leaves the server, and only when a provider key is configured:
       · the product name, normalized, to the embedding provider (OpenAI or
         Voyage) — src/core/match/pipeline.ts, embedder.embed([query]);
       · for uncertain rows only, the cleaned product name, the row's unit and
         a derived yes/no "prepared dish" flag, to the reranker (Anthropic) —
         renderRow in src/core/match/rerank-prompt.ts (since eb10b2c).
     Barcode, price and every other column never do.
   - Deletion: lead files are erased after LEAD_FILE_RETENTION_DAYS by
     `npm run purge:expired` (daily job, DEPLOY.md) and at once on request
     (`npm run lead:delete`), src/lib/retention.ts. App users delete their own
     catalogues at /catalogs, which also removes findings, cached AI verdicts
     and the log entries naming its products (deleteCatalog,
     src/lib/catalogs.ts). */
export const DATA_FLOW = {
  stored:
    'Fayl serverimizda saqlanadi: tuzatilgan Excelni asl koʻrinishida '
    + 'qaytarish uchun. Tahlilda toʻrt ustun oʻqiladi: tovar nomi, shtrix kod, '
    + 'MXIK kodi va oʻlchov birligi.',
  external:
    'Tavsiyani aniqlashtirish uchun tashqi AI xizmatiga faqat tovar nomi va '
    + 'oʻlchov birligi yuborilishi mumkin. Narx, shtrix kod, miqdor va boshqa '
    + 'ustunlar serverdan chiqmaydi.',
  optOut: 'Xohlasangiz, katalogingizni tashqi xizmatsiz tekshiramiz.',
  deletion:
    `Bepul audit uchun yuborilgan fayl ${LEAD_FILE_RETENTION_DAYS} kundan keyin oʻchiriladi, `
    + 'soʻrovingiz boʻyicha darhol.',
  appDeletion:
    'Ilovaga yuklagan katalogingizni istalgan payt oʻzingiz oʻchirasiz, '
    + 'topilmalari va qarorlar yozuvlari bilan birga.',
  purpose: 'Fayl faqat shu audit uchun ishlatiladi.',
} as const;
