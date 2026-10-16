import { SAMPLE_REPORT } from '@/lib/sample-report.generated';
import { CHECKS, COLUMN_MAP, FOCUS_ROW, STRICT_UNIT_PCT, TYPE_LABEL, fixText } from './data';
import { FigureHead, FlowArrow, Mark } from './primitives';

/**
 * The hero figure: catalogue rows go in, the same rows come out with what is
 * wrong and what to use instead. Real rows from the frozen sample, so the codes
 * are real codes. No totals here: the sample's totals appear once, in the
 * report section.
 */
export function TransformFigure() {
  const rows = SAMPLE_REPORT.rows.slice(0, 4);

  return (
    <figure className="m-0">
      <div className="border border-rule bg-paper-raised">
        <FigureHead label="Katalogingiz" meta="namunadan 4 qator" />
        <ul className="list-none p-0">
          {rows.map((row, i) => (
            <li
              key={i}
              className="flex items-center gap-3 border-b border-rule px-4 py-2.5 last:border-b-0"
            >
              <span className="min-w-0 flex-1 truncate text-[13px]">{row.productName}</span>
              <span className="shrink-0 code text-xs text-ink-soft">
                {row.currentMxik ?? <span className="font-sans text-ink-faint">kod yoʻq</span>}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="px-4">
        <FlowArrow label="MXIK audit" />
      </div>

      <div className="border border-risk/30 bg-paper-raised">
        <FigureHead label="Risk hisoboti" />
        <ul className="list-none p-0">
          {rows.map((row, i) => (
            <li
              key={i}
              className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-b border-rule px-4 py-2.5 last:border-b-0"
            >
              <span className="flex min-w-0 flex-1 items-center gap-2.5">
                <Mark risk />
                <span className="text-[13px] text-risk">{TYPE_LABEL[row.type] ?? row.type}</span>
              </span>
              {row.type === 'UNIT_CONFLICT' ? (
                <span className="text-xs text-ok">
                  birlik «{row.unit}» → «{row.requiredUnit}»
                </span>
              ) : (
                <span className="code text-xs text-ok">
                  {row.suggestedMxik ? `→ ${row.suggestedMxik}` : '—'}
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>

      <figcaption className="mt-3 text-xs text-ink-faint">
        Namunaviy katalogdan. Kodlar va topilmalar — tizim chiqargani, qoʻlda
        yozilmagan.
      </figcaption>
    </figure>
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
            {/* The whole point: what this valid-looking code actually means. */}
            {FOCUS_ROW.currentName ? (
              <dd className="mt-1 text-sm text-ink-soft">
                Tasniflagichda bu kod: <span className="text-ink">{FOCUS_ROW.currentName}</span>
              </dd>
            ) : null}
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
            <dt className="eyebrow">Taklif etilgan kod</dt>
            <dd className="mt-1.5 code text-[15px] text-ok sm:text-[17px]">
              {fixText(FOCUS_ROW)}
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
              <span className="code w-5 shrink-0 text-xs text-ink-faint tnum">
                {String(i + 1).padStart(2, '0')}
              </span>
              <span className="min-w-0 flex-1 text-[13px]">{c.q}</span>
              {fails ? (
                <span className="shrink-0 text-xs text-risk">{c.fail}</span>
              ) : (
                <span aria-hidden="true" className="shrink-0 text-xs text-ok">
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
