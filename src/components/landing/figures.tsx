import { SAMPLE_REPORT } from '@/lib/sample-report.generated';
import {
  CHECKS, CLEAN_ROWS, COLUMN_MAP, FINDINGS, FOCUS_ROW, SNAPSHOT, STRICT_UNIT_PCT,
  TYPE_LABEL, nf,
} from './data';
import { FigureHead, FlowArrow, Mark } from './primitives';

/**
 * The hero figure: a catalogue goes in, an audit runs, a count comes out. Rows
 * are real findings from the frozen sample, so the codes are real codes.
 */
export function TransformFigure() {
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
export function RiskStrip({ ticks = 60 }: { ticks?: number }) {
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
export function BeforeAfterFigure() {
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
export function MappingFigure() {
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
export function ChecksFigure() {
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
export function DecisionFigure() {
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
