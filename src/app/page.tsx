import type { Metadata } from 'next';
import Link from 'next/link';
import { SAMPLE_REPORT } from '@/lib/sample-report.generated';
import { LeadForm } from './lead-form';

export const metadata: Metadata = {
  title: 'MXIK Audit — katalogingizdagi xavfli MXIK kodlarini toping',
  description:
    'Excel yoki CSV katalogingizni yuklang, riskli MXIK pozitsiyalari roʻyxatini '
    + 'bepul oling. Tasniflagichda 438 925 kod bor — qoʻlda tekshirish real emas.',
};

const nf = new Intl.NumberFormat('uz-UZ');

/* Every figure on this page is measured, not estimated. Sources are in
   docs/gate0-report.md, which names the npm script that reproduces each one.
   Nothing here may become a round number because it reads better.

   Deliberately NOT on this page: the current 66.7% / 83.3% matching accuracy.
   It is measured over 12 of 30 golden cases with the LLM reranker off and a
   non-semantic embedding stand-in, so it is internal and incomplete. Also not
   here: the old "99% strict unit binding" figure, which Gate 0 disproved. */
const CATALOG_CODES = 438_925;      // gate0 §1 — codes in the official export
const SUBPOSITIONS = 10_215;        // gate0 §9 — subposition nodes
const CANONICAL_UNITS = 168;        // gate0 §4 — parsed canonical unit names
const MARKED_CODES = 124_169;       // gate0 §5 — confirmed digitally marked
const STRICT_UNIT_PCT = '87,8%';    // gate0 §4 — 385,414 of 438,925
const AUTOMATED_TESTS = 198;        // npm test — keep in step with the suite
const SNAPSHOT = '20.08.2026';

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
const FOCUS_ROW = rowOfType('MISMATCH');

const CLEAN_ROWS = SAMPLE_REPORT.totalRows - SAMPLE_REPORT.riskyRows;

/* ------------------------------------------------------------------ evidence */

/* Live queries against the portal's own search on the snapshot date; gate0 §7.
   These two are the headline pair because they need no explanation: the same
   product, spelled two ways, answered usefully once and uselessly the other
   time. The reader recognises both products instantly. */
const HEADLINE_EVIDENCE = [
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

const EVIDENCE_ROWS = [
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
const CONSEQUENCES = [
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

const FINDINGS = [
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
const CHECKS = [
  { q: 'Qatorda MXIK kodi bormi?', fail: 'Kod yoʻq' },
  { q: 'Kod tasniflagichda bormi?', fail: 'Bazada topilmadi' },
  { q: 'Kod tovar nomiga mos keladimi?', fail: 'Nomga mos emas' },
  { q: 'Oʻlchov birligi kodga mos keladimi?', fail: 'Oʻlchov birligi mos emas' },
] as const;

/* Column headers the importer recognises. Both scripts appear in real
   catalogues — Gate 0 found 23% of the official Latin export carries Cyrillic
   inside otherwise Latin strings, and customer files are worse. */
const COLUMN_MAP = [
  { from: 'Наименование товара', to: 'Tovar nomi' },
  { from: 'Штрих-код', to: 'Shtrix kod' },
  { from: 'MXIK kodi', to: 'MXIK kodi' },
  { from: 'Ед. изм.', to: 'Oʻlchov birligi' },
] as const;

const DELIVERABLES = [
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

const PRICING = [
  { rows: '500 SKU gacha', price: '700 000' },
  { rows: '2 000 SKU gacha', price: '1 500 000' },
  { rows: '10 000 SKU gacha', price: '4 000 000' },
] as const;

const TYPE_LABEL: Record<string, string> = {
  MISSING: 'Kod yoʻq',
  NOT_FOUND: 'Bazada topilmadi',
  MISMATCH: 'Nomga mos emas',
  UNIT_CONFLICT: 'Oʻlchov birligi',
};

/* ----------------------------------------------------------------- primitives */

const WRAP = 'mx-auto w-full max-w-6xl px-5 sm:px-8 lg:px-10';

/** One primary action on the page, in three places: hero, after the report, and
 *  the form itself. Anything else on the page is a quiet link. */
function Cta({ className = '' }: { className?: string }) {
  return (
    <a
      href="#audit"
      className={
        'inline-flex items-center justify-center gap-2 bg-ink px-6 py-3.5 '
        + 'font-medium text-paper transition-colors hover:bg-black '
        + `focus-visible:outline-offset-4 ${className}`
      }
    >
      <span className="whitespace-nowrap">Katalogni bepul tekshirtirish</span>
      <span aria-hidden="true">→</span>
    </a>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <p className="eyebrow">{children}</p>;
}

/**
 * Full-bleed rule-to-rule band. Big measured numbers should feel like a total
 * line ruled off in a report, not like a KPI card, so: hairlines, tabular
 * figures, no rounded corners, no shadow, no icon.
 */
function DataBand({
  items,
  tone = 'neutral',
}: {
  items: readonly { value: string; label: string; note?: string }[];
  tone?: 'neutral' | 'risk';
}) {
  return (
    <div className={`border-y border-rule ${tone === 'risk' ? 'bg-risk-tint' : 'bg-paper-tint'}`}>
      <dl
        className={
          `${WRAP} grid grid-cols-1 divide-y divide-rule sm:grid-cols-3 `
          + 'sm:divide-x sm:divide-y-0'
        }
      >
        {items.map((item) => (
          <div key={item.label} className="py-7 sm:px-7 sm:py-8 sm:first:pl-0 sm:last:pr-0">
            <dt className="sr-only">{item.label}</dt>
            <dd>
              <span
                className={
                  'block font-serif text-[34px] leading-none tnum sm:text-[40px] '
                  + (tone === 'risk' ? 'text-risk' : '')
                }
              >
                {item.value}
              </span>
              <span className="mt-2.5 block max-w-[26ch] text-sm text-ink-soft">{item.label}</span>
              {item.note ? (
                <span className="mt-1 block max-w-[30ch] text-xs text-ink-faint">{item.note}</span>
              ) : null}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/* --------------------------------------------------------------- diagram parts

   These are drawing primitives, not miniature copies of the application. They
   have no navigation, no toolbar and no clickable-looking controls: a reader
   must never mistake a figure for the product, in either direction. What they
   carry is structure — a row, a rule, a marker, an arrow, a code. */

/** Caption strip that names a figure, the way a table in a report is titled. */
function FigureHead({ label, meta }: { label: string; meta?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-rule px-4 py-2.5">
      <span className="eyebrow">{label}</span>
      {meta ? <span className="text-[11px] text-ink-faint tnum">{meta}</span> : null}
    </div>
  );
}

/** Risk or verified marker. A single glyph, never a coloured pill. */
function Mark({ risk }: { risk: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={
        'inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center border text-[11px] '
        + (risk ? 'border-risk/40 text-risk' : 'border-rule-strong text-ink-faint')
      }
    >
      {risk ? '!' : '✓'}
    </span>
  );
}

function FlowArrow({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 py-3.5" aria-hidden="true">
      <span className="text-ink-faint">↓</span>
      {label ? <span className="eyebrow">{label}</span> : null}
      <span className="h-px flex-1 bg-rule" />
    </div>
  );
}

/**
 * The hero figure: a catalogue goes in, an audit runs, a count comes out. Rows
 * are real findings from the frozen sample, so the codes are real codes.
 */
function TransformFigure() {
  const rows = SAMPLE_REPORT.rows.slice(0, 4);

  return (
    <figure className="m-0">
      <div className="border border-rule bg-paper-raised">
        <FigureHead label="Katalog" meta={`${nf.format(SAMPLE_REPORT.totalRows)} qator`} />

        <ul className="list-none p-0">
          {rows.map((row, i) => (
            <li
              key={i}
              className="flex items-center gap-3 border-b border-rule px-4 py-2.5 last:border-b-0"
            >
              <Mark risk />
              <span className="min-w-0 flex-1 truncate text-[13px]">{row.productName}</span>
              <span className="shrink-0 code text-[11px] text-ink-soft">
                {row.currentMxik ?? <span className="font-sans text-ink-faint">kod yoʻq</span>}
              </span>
            </li>
          ))}
        </ul>

        {/* The clean remainder, collapsed to one line: the point of the figure is
            that the few bad rows are buried in the many good ones. */}
        <div className="flex items-center gap-3 border-t border-rule bg-paper-tint px-4 py-2.5">
          <Mark risk={false} />
          <span className="min-w-0 flex-1 text-[13px] text-ink-soft">
            <span className="tnum">{nf.format(CLEAN_ROWS)}</span> qator — muammo topilmadi
          </span>
        </div>
      </div>

      <div className="px-4">
        <FlowArrow label="MXIK audit" />
      </div>

      <div className="border border-risk/30 bg-risk-tint">
        <FigureHead label="Risk hisoboti" meta={SNAPSHOT} />
        <div className="px-4 py-5">
          <p className="font-serif text-[30px] leading-none text-risk sm:text-[34px]">
            <span className="tnum">{nf.format(SAMPLE_REPORT.totalRows)}</span>
            <span className="mx-2 text-ink-faint" aria-hidden="true">→</span>
            <span className="tnum">{nf.format(SAMPLE_REPORT.riskyRows)}</span>
          </p>
          <p className="mt-2 text-[13px] text-ink-soft">riskli pozitsiya</p>

          <dl className="mt-4 grid grid-cols-2 gap-x-5 gap-y-2 border-t border-risk/20 pt-4">
            {FINDINGS.map((f) => (
              <div key={f.key} className="flex items-baseline gap-2">
                <dd className="code text-[13px] font-medium tnum">
                  {SAMPLE_REPORT.byType[f.key]}
                </dd>
                <dt className="min-w-0 text-[11px] text-ink-soft">{f.label}</dt>
              </div>
            ))}
          </dl>
        </div>
      </div>

      <figcaption className="mt-3 text-xs text-ink-faint">
        Sxema — namuna auditning haqiqiy natijasidan tuzilgan: kodlar, topilma
        turlari va sonlar tizim chiqargani.
      </figcaption>
    </figure>
  );
}

/**
 * The problem figure: the sample report's proportion of findings, drawn as a
 * strip. The *count* is measured; the arrangement cannot be, since which rows
 * are bad is exactly what the reader does not know. So the count is exact and
 * the placement is scattered by a fixed seed — an evenly spaced version reads
 * as a repeating pattern, which is the opposite of the point being made.
 */
function RiskStrip({ ticks = 60 }: { ticks?: number }) {
  const marks = Math.round((ticks * SAMPLE_REPORT.riskyRows) / SAMPLE_REPORT.totalRows);

  // Fisher–Yates over a fixed-seed LCG: deterministic between server and client
  // (no hydration mismatch) and identical on every build.
  const order = Array.from({ length: ticks }, (_, i) => i);
  let seed = 20260820;
  for (let i = order.length - 1; i > 0; i--) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const j = seed % (i + 1);
    [order[i], order[j]] = [order[j] as number, order[i] as number];
  }
  const flagged = new Set(order.slice(0, marks));

  return (
    <div>
      <div className="flex items-end gap-[3px]" aria-hidden="true">
        {Array.from({ length: ticks }, (_, i) => (
          <span
            key={i}
            className={`w-full ${flagged.has(i) ? 'h-7 bg-risk' : 'h-3.5 bg-rule-strong'}`}
          />
        ))}
      </div>
      <p className="mt-3 text-xs text-ink-faint">
        Har <span className="tnum">{nf.format(SAMPLE_REPORT.totalRows)}</span> qatordan{' '}
        <span className="tnum text-risk">{nf.format(SAMPLE_REPORT.riskyRows)}</span> tasi — namuna
        auditdagi ulush. Qaysi biri ekani tashqaridan koʻrinmaydi.
      </p>
    </div>
  );
}

/** One row opened up: what was there, what is wrong with it, what is proposed. */
function BeforeAfterFigure() {
  return (
    <figure className="m-0 border border-rule bg-paper-raised">
      <FigureHead label="Bitta qator" meta="namuna auditdan" />
      <div className="p-4 sm:p-6">
        <p className="text-[15px]">{FOCUS_ROW.productName}</p>

        <dl className="mt-5 space-y-4">
          <div>
            <dt className="eyebrow">Katalogdagi kod</dt>
            <dd className="mt-1.5 code text-[15px] sm:text-[17px]">{FOCUS_ROW.currentMxik}</dd>
          </div>

          <div className="border-l-2 border-risk pl-4">
            <dt className="eyebrow text-risk">Topilma</dt>
            <dd className="mt-1 text-sm">
              <span className="text-risk">{TYPE_LABEL[FOCUS_ROW.type]}</span>
              <span className="mt-0.5 block text-ink-soft">
                Kod tasniflagichda bor, lekin boshqa tovarni bildiradi.
              </span>
            </dd>
          </div>

          <div>
            <dt className="eyebrow">Tavsiya etilgan kod</dt>
            <dd className="mt-1.5 code text-[15px] text-ok sm:text-[17px]">
              {FOCUS_ROW.suggestedMxik}
            </dd>
            <dd className="mt-1 text-sm text-ink-soft">{FOCUS_ROW.suggestedName}</dd>
          </div>
        </dl>
      </div>
    </figure>
  );
}

/** Step 01 — the importer's column mapping, as a mapping table. */
function MappingFigure() {
  return (
    <figure className="m-0 border border-rule bg-paper-raised">
      <FigureHead label="Ustunlarni moslashtirish" meta="avtomatik" />
      <dl className="list-none p-0">
        {COLUMN_MAP.map((c) => (
          <div
            key={c.from}
            className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-baseline gap-3 border-b border-rule px-4 py-3 last:border-b-0 sm:gap-5"
          >
            <dt className="min-w-0 truncate text-[13px] text-ink-soft">{c.from}</dt>
            <span aria-hidden="true" className="text-ink-faint">→</span>
            <dd className="min-w-0 truncate text-[13px] font-medium">{c.to}</dd>
          </div>
        ))}
      </dl>
      <p className="border-t border-rule px-4 py-2.5 text-xs text-ink-faint">
        Oʻzbekcha ham, ruscha sarlavhalar ham tanib olinadi.
      </p>
    </figure>
  );
}

/** Step 02 — the four checks run against one row, drawn as a decision list. */
function ChecksFigure() {
  return (
    <figure className="m-0 border border-rule bg-paper-raised">
      <FigureHead label="Toʻrt tekshiruv" meta="har bir qator uchun" />
      <ul className="list-none p-0">
        {CHECKS.map((c, i) => {
          // The walkthrough row fails exactly one check: the name match.
          const fails = c.fail === TYPE_LABEL['MISMATCH'];
          return (
            <li
              key={c.q}
              className="flex items-center gap-3 border-b border-rule px-4 py-3 last:border-b-0"
            >
              <span className="code w-5 shrink-0 text-[11px] text-ink-faint tnum">
                {String(i + 1).padStart(2, '0')}
              </span>
              <span className="min-w-0 flex-1 text-[13px]">{c.q}</span>
              {fails ? (
                <span className="shrink-0 text-[12px] text-risk">{c.fail}</span>
              ) : (
                <span aria-hidden="true" className="shrink-0 text-[12px] text-ok">
                  ✓
                </span>
              )}
            </li>
          );
        })}
      </ul>
      <p className="border-t border-rule bg-paper-tint px-4 py-3 text-xs text-ink-soft">
        Oʻlchov birligi tekshiruvi tasniflagichdagi qatʼiy biriktirilgan birlikka
        tayanadi — bu kodlarning {STRICT_UNIT_PCT} ida mavjud. Qolganida tizim
        jim turadi, taxmin qilmaydi.
      </p>
    </figure>
  );
}

/** Step 03 — the decision and what it produces. Static tokens, not controls. */
function DecisionFigure() {
  return (
    <figure className="m-0 border border-rule bg-paper-raised">
      {/* No confidence figure here: out of context a high number reads as a
          promise, and the sample's confidences skew high (see the report note). */}
      <FigureHead label="Taklif" meta="namuna auditdan" />
      <div className="p-4 sm:p-6">
        <p className="code text-[15px] text-ok sm:text-[17px]">{FOCUS_ROW.suggestedMxik}</p>
        <p className="mt-1.5 text-sm">{FOCUS_ROW.suggestedName}</p>
        <p className="mt-3 text-xs text-ink-soft">
          Tasniflagichdagi oʻrni va biriktirilgan oʻlchov birligi taklif yonida
          koʻrsatiladi.
        </p>

        <div className="mt-5 flex flex-wrap gap-3 border-t border-rule pt-5" aria-hidden="true">
          <span className="inline-flex items-center gap-2 border border-ok/40 px-3 py-1.5 text-[13px] text-ok">
            ✓ Tasdiqlash
          </span>
          <span className="inline-flex items-center gap-2 border border-rule-strong px-3 py-1.5 text-[13px] text-ink-soft">
            ✕ Rad etish
          </span>
        </div>
      </div>
      <div className="border-t border-rule bg-paper-tint px-4 py-3 text-xs text-ink-soft">
        <span aria-hidden="true" className="text-ink-faint">→ </span>
        Excel eksport · har bir qaror tarixda qoladi
      </div>
    </figure>
  );
}

/* ---------------------------------------------------------------------- page */

export default function LandingPage() {
  const s = SAMPLE_REPORT;
  const count = (key: keyof typeof s.byType): number => s.byType[key];

  const STEPS = [
    {
      n: '01',
      title: 'Yuklang',
      body:
        'Excel yoki CSV katalogingizni tashlang. Ustunlar avtomatik aniqlanadi — '
        + 'oʻzbekcha ham, ruscha sarlavhalar ham.',
      figure: <MappingFigure />,
    },
    {
      n: '02',
      title: 'Tekshiring',
      body:
        'Har bir pozitsiya tasniflagich bilan solishtiriladi. Toʻrt tekshiruvdan '
        + 'birortasi oʻtmasa, qator riskli deb belgilanadi.',
      figure: <ChecksFigure />,
    },
    {
      n: '03',
      title: 'Qaror qiling',
      body:
        'Tavsiya etilgan kodni tasdiqlaysiz yoki rad etasiz. Natijani Excel '
        + 'sifatida olasiz, qarorlar tarixi saqlanadi.',
      figure: <DecisionFigure />,
    },
  ];

  return (
    <>
      <header className="border-b border-rule">
        <div className={`${WRAP} flex items-baseline justify-between py-4`}>
          <span className="font-serif text-lg font-semibold">MXIK Audit</span>
          <Link href="/sign-in" className="-my-2 inline-block py-2 text-sm text-ink-soft underline hover:text-ink">
            Kirish
          </Link>
        </div>
      </header>

      <main>
        {/* ---------------------------------------------------------------- hero
            Five seconds to answer one question: what do I upload and what do I
            get back. The figure answers the second half without a screenshot. */}
        <section className={`${WRAP} pt-10 pb-12 sm:pt-14 lg:pt-16 lg:pb-16`}>
          {/* Explicit placement rather than source order, because the two orders
              differ: on a phone the figure has to come between the CTA and the
              supporting facts, on a desktop it sits beside both. */}
          <div className="grid grid-cols-1 items-start gap-10 lg:grid-cols-[minmax(0,46fr)_minmax(0,54fr)] lg:gap-x-14 lg:gap-y-8">
            <div className="min-w-0 lg:col-start-1 lg:row-start-1">
              <Eyebrow>MXIK katalog auditi</Eyebrow>
              <h1 className="mt-3.5 text-[34px] leading-[1.08] sm:text-[44px] lg:text-[46px]">
                Katalogingizdagi xavfli MXIK kodlarini toping.
              </h1>
              <p className="mt-5 max-w-[52ch] text-[17px] leading-relaxed text-ink-soft">
                Excel yoki CSV katalogingizni yuklang. MXIK Audit mavjud kodlarni
                tekshiradi, mos kelmaydigan va muammoli pozitsiyalarni ajratadi va
                tavsiya etilgan kodlarni koʻrsatadi.
              </p>

              <div className="mt-8 flex flex-col items-stretch gap-4 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-7 sm:gap-y-4">
                <Cta />
                <a href="#hisobot" className="-my-2 inline-block py-2 text-sm text-ink-soft underline hover:text-ink">
                  Hisobot qanday koʻrinishini koʻrish
                </a>
              </div>
            </div>

            <div className="min-w-0 lg:col-start-2 lg:row-start-1 lg:row-span-2">
              <TransformFigure />
            </div>

            {/* Typographic, not badges: a rule and four facts, like a byline. */}
            <ul className="grid grid-cols-2 gap-x-6 gap-y-2.5 border-t border-rule pt-4 text-xs text-ink-soft sm:flex sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-3 sm:gap-y-2 lg:col-start-1 lg:row-start-2">
              {[
                `${nf.format(CATALOG_CODES)} MXIK kodi`,
                `${AUTOMATED_TESTS} avtomatik test`,
                'Excel / CSV',
                'Audit bepul',
              ].map((fact, i) => (
                <li key={fact} className="flex items-baseline gap-3">
                  {i > 0 ? (
                    <span aria-hidden="true" className="hidden text-ink-faint sm:inline">
                      ·
                    </span>
                  ) : null}
                  <span className="tnum">{fact}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ------------------------------------------------------------- problem */}
        <section className="border-t border-rule pt-14 sm:pt-16">
          <div className={WRAP}>
            <Eyebrow>Muammo</Eyebrow>
            <h2 className="mt-3 max-w-[24ch] text-[27px] leading-tight sm:text-[32px]">
              Muammo minglab oddiy qator ichida yashiringan
            </h2>
            <p className="mt-4 max-w-[62ch] text-ink-soft">
              Rasmiy tasniflagich — bir necha yuz ming pozitsiyadan iborat, toʻrt
              darajali daraxt. Portal kodlarni bittalab qidiradi. Uch ming pozitsiyali
              katalogni shu yoʻl bilan tekshirish — haftalar ish, va har bir qator odam
              eʼtiborining aniqligiga bogʻliq.
            </p>

            <div className="mt-9">
              <RiskStrip />
            </div>

            <div className="mt-10 grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:gap-12">
              <div className="min-w-0 lg:order-2">
                <BeforeAfterFigure />
              </div>
              <div className="lg:order-1">
                <h3 className="text-[19px]">Eng xavfli topilma — koʻrinmaydigani</h3>
                <p className="mt-2.5 max-w-[52ch] text-ink-soft">
                  Boʻsh kod ustun boʻylab darrov koʻzga tashlanadi. Haqiqiy, lekin boshqa
                  tovarga tegishli kod esa tashqaridan mutlaqo normal koʻrinadi: 17 xona
                  raqam oʻz joyida turadi. Buni faqat kodni tasniflagichdagi nomi bilan
                  solishtirib aniqlash mumkin.
                </p>
                <p className="mt-3 max-w-[52ch] text-ink-soft">
                  Namuna auditda ana shunday qatorlar eng katta guruhni tashkil qildi:{' '}
                  <span className="tnum">{count('MISMATCH')}</span> ta.
                </p>
              </div>
            </div>
          </div>

          <div className="mt-14">
            <DataBand
              items={[
                { value: nf.format(CATALOG_CODES), label: 'Tasniflagichdagi kod soni' },
                {
                  value: nf.format(SUBPOSITIONS),
                  label: 'Subpozitsiya — kod tanlanadigan daraja',
                },
                {
                  value: STRICT_UNIT_PCT,
                  label: 'Kodlarda oʻlchov birligi qatʼiy biriktirilgan',
                  note: 'Yaʼni birlik mos kelmasa, buni tekshirib aniqlash mumkin',
                },
              ]}
            />
          </div>
        </section>

        {/* ------------------------------------------------------------ evidence
            The strongest asset in the project: not a claim that the portal is
            hard to use, a record of what its own search returns. */}
        <section className={`${WRAP} py-14 sm:py-16`}>
          <Eyebrow>Dalil</Eyebrow>
          <h2 className="mt-3 max-w-[28ch] text-[27px] leading-tight sm:text-[32px]">
            Rasmiy qidiruv har doim ishonchli javob bermaydi
          </h2>
          <p className="mt-4 max-w-[62ch] text-ink-soft">
            Quyidagilar — portalning oʻz qidiruvi qaytargan haqiqiy natijalar,
            {' '}{SNAPSHOT} holatiga. Har birini oʻzingiz takrorlab koʻrishingiz mumkin.
          </p>

          <div className="mt-9 grid grid-cols-1 gap-px border border-rule bg-rule sm:grid-cols-2">
            {HEADLINE_EVIDENCE.map((e) => (
              <div key={e.query} className="bg-paper p-6 sm:p-7">
                <p className="eyebrow">Soʻrov</p>
                <p className="mt-2 break-words code text-[17px] font-medium">{e.query}</p>
                <p className="mt-1 text-xs text-ink-faint">{e.queryNote}</p>

                <p className="mt-5 flex items-baseline gap-2 text-sm text-ink-faint">
                  <span aria-hidden="true">↓</span>
                  <span>Portal qaytardi</span>
                </p>
                <p className="mt-1.5 font-serif text-[26px] leading-tight text-risk sm:text-[30px]">
                  {e.result}
                </p>
                <p className="mt-1 text-xs text-ink-faint">{e.resultNote}</p>

                <div className="mt-6 border-t border-rule pt-4">
                  <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
                    <span className="break-words code text-xs text-ink-soft">
                      {e.contrastQuery}
                    </span>
                    <span aria-hidden="true" className="text-ink-faint">→</span>
                    <span className="text-ok">{e.contrastResult}</span>
                  </p>
                  <p className="mt-2 text-sm text-ink-soft">{e.lesson}</p>
                </div>
              </div>
            ))}
          </div>

          {/* A dl, not a table: at 360px two columns of Cyrillic query text and
              result text cannot share a row without one of them shredding. */}
          <dl className="mt-9 border-t border-rule">
            {EVIDENCE_ROWS.map((row) => (
              <div
                key={row.query}
                className="grid gap-1 border-b border-rule py-4 sm:grid-cols-[minmax(0,20ch)_minmax(0,1fr)] sm:items-baseline sm:gap-6"
              >
                <dt className="break-words code text-sm">{row.query}</dt>
                <dd>
                  <span className={row.bad ? 'text-risk' : 'text-ok'}>{row.result}</span>
                  <span className="mt-0.5 block text-xs text-ink-faint">{row.note}</span>
                </dd>
              </div>
            ))}
          </dl>

          <p className="mt-8 max-w-[62ch] border-l-2 border-risk pl-5 text-[17px] leading-relaxed">
            <strong className="font-medium">
              Muammo faqat kodni topish emas. Notoʻgʻri natija toʻgʻri koʻrinishda
              chiqishi mumkin
            </strong>{' '}
            — va u hisobvaraq-fakturaga shu holda tushadi.
          </p>
        </section>

        {/* -------------------------------------------------------- consequences */}
        <section className="border-t border-rule py-14 sm:py-16">
          <div className={WRAP}>
            <Eyebrow>Oqibat</Eyebrow>
            <h2 className="mt-3 max-w-[26ch] text-[27px] leading-tight sm:text-[32px]">
              Notoʻgʻri kod nimaga olib keladi
            </h2>

            <div className="mt-9 grid grid-cols-1 gap-x-12 gap-y-9 sm:grid-cols-2">
              {CONSEQUENCES.map((c) => (
                <div key={c.title} className="border-t-2 border-risk pt-4">
                  <h3 className="text-[19px]">{c.title}</h3>
                  <p className="mt-2 max-w-[46ch] text-sm text-ink-soft">{c.body}</p>
                  <p className="mt-3 text-xs text-ink-faint">
                    {c.cite && c.citeHref ? (
                      <>
                        <a
                          href={c.citeHref}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline"
                        >
                          {c.cite}
                        </a>
                        {' — '}
                      </>
                    ) : null}
                    {c.citeNote}
                  </p>
                </div>
              ))}
            </div>

            <p className="mt-9 max-w-[68ch] text-xs text-ink-faint">
              Yuqoridagilardan faqat birinchisi aniq normativ hujjatga tayanadi va
              havolasi keltirilgan. Qolganlari — amaliyot va tizim mexanizmi tavsifi;
              biz ularga modda raqamini biriktirmaymiz va yuridik xulosa sifatida
              taqdim etmaymiz.
            </p>
          </div>
        </section>

        {/* ---------------------------------------------------------------- steps */}
        <section className="border-t border-rule py-14 sm:py-16">
          <div className={WRAP}>
            <Eyebrow>Qanday ishlaydi</Eyebrow>
            <h2 className="mt-3 text-[27px] leading-tight sm:text-[32px]">Uch qadam</h2>

            <ol className="mt-10 grid grid-cols-1 list-none gap-10 p-0 lg:grid-cols-3 lg:gap-8">
              {STEPS.map((step) => (
                <li key={step.n} className="flex min-w-0 flex-col">
                  <div className="flex items-baseline gap-4">
                    <span className="font-serif text-[22px] text-ink-faint tnum">{step.n}</span>
                    <h3 className="text-[22px]">{step.title}</h3>
                  </div>
                  {/* A floor, not a fixed height: it lines the three figures up on a
                      three-column row without breaking if the copy grows. */}
                  <p className="mt-2.5 max-w-[52ch] text-sm text-ink-soft lg:min-h-[4.75rem]">
                    {step.body}
                  </p>
                  <div className="mt-5">{step.figure}</div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* --------------------------------------------------------------- report
            The report is the product. It gets the biggest number on the page. */}
        <section id="hisobot" className="border-t border-rule pt-14 sm:pt-16">
          <div className={WRAP}>
            <Eyebrow>Hisobot</Eyebrow>
            <h2 className="mt-3 max-w-[26ch] text-[27px] leading-tight sm:text-[32px]">
              Birinchi ekranda — bitta son
            </h2>
            <p className="mt-4 max-w-[62ch] text-ink-soft">
              Auditdan keyin siz nimani bilmasligingizni emas, nimani tuzatish
              kerakligini koʻrasiz. Quyida — namuna katalogdagi haqiqiy natija.
            </p>
          </div>

          <div className="mt-10 border-y border-rule bg-risk-tint">
            <div className={`${WRAP} py-10 sm:py-12`}>
              <p className="font-serif text-[40px] leading-[1.05] text-risk sm:text-[56px] lg:text-[64px]">
                <span className="tnum">{nf.format(s.totalRows)}</span> pozitsiyadan{' '}
                <span className="tnum">{nf.format(s.riskyRows)}</span> tasi riskli
              </p>
              <p className="mt-4 max-w-[52ch] text-sm text-ink-soft">
                Namuna katalog, {SNAPSHOT}. Toʻrt turdagi topilma boʻyicha taqsimoti
                quyida.
              </p>
            </div>
          </div>

          <div className={`${WRAP} pt-12 pb-14 sm:pb-16`}>
            <dl className="grid grid-cols-1 gap-px border border-rule bg-rule sm:grid-cols-2 lg:grid-cols-4">
              {FINDINGS.map((f) => (
                <div key={f.key} className="bg-paper p-5 sm:p-6">
                  <dd className="font-serif text-[32px] leading-none tnum">{count(f.key)}</dd>
                  <dt className="mt-3 text-sm font-medium">{f.label}</dt>
                  <p className="mt-1.5 text-xs text-ink-soft">{f.body}</p>
                </div>
              ))}
            </dl>

            {/* This audience adds the column up. 23+16+33+13 is 85, not 83, and
                an unexplained two-row gap looks like a bug in the arithmetic. */}
            <p className="mt-4 text-xs text-ink-faint">
              Topilmalar yigʻindisi{' '}
              <span className="tnum">
                {FINDINGS.reduce((sum, f) => sum + count(f.key), 0)}
              </span>{' '}
              ta — riskli qatorlar sonidan{' '}
              <span className="tnum">{nf.format(s.riskyRows)}</span> ta koʻp, chunki bitta
              qatorda bir vaqtning oʻzida bir nechta muammo boʻlishi mumkin.
            </p>

            {/* Our own table of the sample findings — the data, set as a table in
                this page's own type. Table on desktop, stacked records on phones:
                a five-column table inside a horizontal scroller is not a mobile
                design. */}
            <div className="mt-10 hidden overflow-hidden border border-rule md:block">
              <table className="min-w-full text-sm">
                <thead className="bg-paper-tint">
                  <tr className="text-left">
                    <th scope="col" className="border-b border-rule px-4 py-2.5 font-medium">
                      Tovar
                    </th>
                    <th scope="col" className="border-b border-rule px-4 py-2.5 font-medium">
                      Turi
                    </th>
                    <th scope="col" className="border-b border-rule px-4 py-2.5 font-medium">
                      Hozirgi
                    </th>
                    <th scope="col" className="border-b border-rule px-4 py-2.5 font-medium">
                      Taklif
                    </th>
                    <th scope="col" className="border-b border-rule px-4 py-2.5 font-medium">
                      Ishonch
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {s.rows.map((row, i) => (
                    <tr key={i} className="border-b border-rule align-top last:border-0">
                      <td className="max-w-[28ch] px-4 py-3">{row.productName}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-ink-soft">
                        {TYPE_LABEL[row.type] ?? row.type}
                      </td>
                      <td className="px-4 py-3 code text-xs">
                        {row.currentMxik ?? <span className="font-sans text-ink-faint">yoʻq</span>}
                      </td>
                      <td className="px-4 py-3 code text-xs">{row.suggestedMxik ?? '—'}</td>
                      <td className="px-4 py-3 text-xs tnum">
                        {row.confidence === null ? '—' : `${Math.round(row.confidence * 100)}%`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <ul className="mt-10 list-none border-t border-rule p-0 md:hidden">
              {s.rows.map((row, i) => (
                <li key={i} className="border-b border-rule py-4">
                  <p className="text-sm">{row.productName}</p>
                  <p className="mt-1 text-xs text-ink-soft">
                    {TYPE_LABEL[row.type] ?? row.type}
                    {row.confidence === null
                      ? null
                      : ` · ishonch ${Math.round(row.confidence * 100)}%`}
                  </p>
                  <dl className="mt-2.5 grid grid-cols-[8ch_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
                    <dt className="text-ink-faint">Hozirgi</dt>
                    <dd className="code">{row.currentMxik ?? <span className="font-sans text-ink-faint">yoʻq</span>}</dd>
                    <dt className="text-ink-faint">Taklif</dt>
                    <dd className="code">{row.suggestedMxik ?? '—'}</dd>
                  </dl>
                </li>
              ))}
            </ul>

            {/* README records that this sample runs on seeded demo data, so its
                confidences skew high. Saying so ourselves costs nothing and is
                the whole positioning of the page. */}
            <p className="mt-5 max-w-[68ch] text-xs text-ink-faint">
              Kodlar, topilma turlari va ishonch koʻrsatkichlari — tizim chiqargani,
              qoʻlda tanlanmagan. Katalogning oʻzi namunaviy, shuning uchun bu
              yerda aniq mosliklar real katalogga qaraganda koʻproq uchraydi va
              ishonch koʻrsatkichlari yuqoriroq chiqadi. Sizning natijangiz boshqacha
              boʻlishi mumkin — buni faqat oʻz faylingizda koʻrish mumkin.
            </p>

            <div className="mt-9 flex flex-col items-stretch gap-4 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-7 sm:gap-y-4">
              <Cta />
              <a href="/demo/namuna-katalog.xlsx" className="-my-2 inline-block py-2 text-sm text-ink-soft underline hover:text-ink" download>
                Namuna fayl tuzilishini yuklab olish
              </a>
            </div>
          </div>
        </section>

        {/* --------------------------------------------------------- deliverables */}
        <section className="border-t border-rule py-14 sm:py-16">
          <div className={WRAP}>
            <Eyebrow>Natija</Eyebrow>
            <h2 className="mt-3 text-[27px] leading-tight sm:text-[32px]">Sizga nima qaytadi?</h2>

            <dl className="mt-9 grid grid-cols-1 gap-x-12 gap-y-8 sm:grid-cols-2">
              {DELIVERABLES.map((d) => (
                <div key={d.title} className="border-t border-ink pt-4">
                  <dt className="font-serif text-[19px]">{d.title}</dt>
                  <dd className="mt-1.5 max-w-[46ch] text-sm text-ink-soft">{d.body}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* ---------------------------------------------------------------- trust */}
        <section className="border-t border-rule py-14 sm:py-16">
          <div className={WRAP}>
            <Eyebrow>Ishonch</Eyebrow>
            <h2 className="mt-3 max-w-[30ch] text-[27px] leading-tight sm:text-[32px]">
              Dastur tavsiya qiladi. Yakuniy qarorni siz qabul qilasiz.
            </h2>

            <div className="mt-9 grid grid-cols-1 gap-x-12 gap-y-9 sm:grid-cols-3">
              <div>
                <h3 className="text-[19px]">Kafolat berilmaydi</h3>
                <p className="mt-2 text-sm text-ink-soft">
                  Bitta tovar uchun qaysi MXIK yagona toʻgʻri ekanini belgilaydigan
                  normativ hujjat mavjud emas. Bir mahsulot uchun ikki xil kod ham
                  asosli boʻlishi mumkin. Shuning uchun har bir taklif yonida
                  tasniflagichdagi oʻrni va ishonch koʻrsatkichi turadi, past ishonch
                  alohida belgilanadi va avtomatik qabul qilinmaydi.
                </p>
              </div>
              <div>
                <h3 className="text-[19px]">Har bir qaror qayd etiladi</h3>
                <p className="mt-2 text-sm text-ink-soft">
                  Har bir tasdiq va rad etish — kim tomonidan va qachon qilingani bilan
                  yozib boriladi. Bu ichki hujjat: kodlar tasodifan emas, koʻrib
                  chiqilib qoʻyilganini koʻrsatadi. Uni yuridik kafolat sifatida
                  taqdim etmaymiz.
                </p>
              </div>
              <div>
                <h3 className="text-[19px]">Maʼlumotlaringiz</h3>
                <p className="mt-2 text-sm text-ink-soft">
                  Tahlilda faqat toʻrt ustun ishlatiladi: tovar nomi, shtrix kod, MXIK
                  kodi va oʻlchov birligi. Aniqlikni oshirish uchun tovar nomlari tashqi
                  xizmatga yuboriladi — faqat nomlar, narx va mijoz maʼlumotlari emas.
                  Xohlasangiz, bu bosqichni oʻchiramiz. Faylni istagan paytda
                  oʻchirishimizni soʻrashingiz mumkin.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* -------------------------------------------------------------- pricing */}
        <section className="border-t border-rule py-14 sm:py-16">
          <div className={WRAP}>
            <Eyebrow>Narx</Eyebrow>
            <h2 className="mt-3 text-[27px] leading-tight sm:text-[32px]">Narxlar</h2>
            <p className="mt-4 max-w-[52ch] text-ink-soft">
              Risk auditi — bepul: avval nechta pozitsiya muammoli ekanini koʻrasiz,
              keyin toʻgʻrilash kerak yoki yoʻqligini oʻzingiz hal qilasiz.
            </p>

            <div className="mt-8 border border-rule">
              <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-rule bg-ok-tint px-5 py-5 sm:px-6">
                <div>
                  <p className="font-medium text-ok">Risk auditi</p>
                  <p className="mt-0.5 text-xs text-ink-soft">
                    Nechta pozitsiya riskli va nimasi notoʻgʻri
                  </p>
                </div>
                <p className="shrink-0 font-serif text-[22px] text-ok">BEPUL</p>
              </div>

              {PRICING.map((p) => (
                <div
                  key={p.rows}
                  className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-rule px-5 py-4 last:border-0 sm:px-6"
                >
                  <div>
                    <p>
                      Toʻgʻrilangan katalog —{' '}
                      <span className="font-medium">{p.rows}</span>
                    </p>
                    <p className="mt-0.5 text-xs text-ink-soft">
                      Tasdiqlangan kodlar qoʻyilgan fayl va qarorlar tarixi
                    </p>
                  </div>
                  <p className="shrink-0 font-serif text-[22px] tnum">
                    {p.price} <span className="font-sans text-sm text-ink-soft">soʻm</span>
                  </p>
                </div>
              ))}
            </div>

            <p className="mt-4 text-xs text-ink-faint">
              Toʻlov bank oʻtkazmasi orqali, ish bajarilgandan keyin.
            </p>
          </div>
        </section>

        {/* ------------------------------------------------------------ the form */}
        <section id="audit" className="border-t border-rule bg-paper-tint py-14 sm:py-16">
          <div className={WRAP}>
            <div className="grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:gap-16">
              <div>
                <h2 className="max-w-[30ch] text-[27px] leading-tight sm:text-[32px]">
                  Katalogingizni yuboring — riskli pozitsiyalar roʻyxatini bepul oling.
                </h2>
                <p className="mt-4 max-w-[52ch] text-ink-soft">
                  Ikki maydon, roʻyxatdan oʻtish yoʻq. Faylni koʻrib chiqamiz va bir ish
                  kuni ichida riskli pozitsiyalar roʻyxatini yuboramiz.
                </p>
                <ul className="mt-7 list-none space-y-2.5 p-0 text-sm text-ink-soft">
                  {[
                    'Excel (.xlsx) yoki CSV — ustunlar tartibi muhim emas',
                    'Fayl faqat audit uchun ishlatiladi, uchinchi shaxslarga berilmaydi',
                    'Istagan paytda oʻchirishimizni soʻrashingiz mumkin',
                  ].map((line) => (
                    <li key={line} className="flex gap-3">
                      <span aria-hidden="true" className="text-ok">
                        ✓
                      </span>
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="border border-rule bg-paper p-6 sm:p-7">
                <LeadForm />
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-rule py-9">
        <div className={`${WRAP} space-y-1.5 text-xs text-ink-faint`}>
          <p>
            Tasniflagich maʼlumotlari <span className="mono">tasnif.soliq.uz</span> rasmiy
            eksportidan olingan, holat: {SNAPSHOT} — {nf.format(CATALOG_CODES)} kod,
            shundan {nf.format(MARKED_CODES)} tasi markirovka qilinadigan,
            {' '}{nf.format(CANONICAL_UNITS)} oʻlchov birligi.
          </p>
          <p>
            Yuridik havolalar <span className="mono">lex.uz</span>ga ishora qiladi. Soliq
            oqibatlari boʻyicha qarorni oʻz maslahatchingiz bilan tasdiqlang.
          </p>
        </div>
      </footer>
    </>
  );
}
