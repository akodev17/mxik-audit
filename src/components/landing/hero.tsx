import { DEMO_URL } from './config';
import { CATALOG_CODES, nf } from './data';
import { TransformFigure } from './figures';
import { CtaPair, Eyebrow, WRAP } from './primitives';

/* Each fact here is checked against code, and none is a developer metric:
   - the classifier size is what the audit compares against (data.ts);
   - Uzbek and Russian headers: HINTS in src/app/actions/catalog.ts;
   - .xlsx and .csv: parseUpload in src/lib/spreadsheet.ts;
   - the last slot names the no-signup demo only when one is configured. */
const FACTS = [
  `${nf.format(CATALOG_CODES)} kod bilan solishtiradi`,
  'Oʻzbekcha va ruscha sarlavhalar',
  'Excel / CSV',
  DEMO_URL ? 'Roʻyxatdan oʻtmasdan demo' : 'Risk auditi bepul',
];

/* Five seconds to answer one question: what do I upload and what do I get
   back. The figure answers the second half without a screenshot. */
export function Hero() {
  return (
    <section className={`${WRAP} pt-9 pb-12 sm:pt-14 lg:pt-16 lg:pb-16`}>
      {/* Explicit placement rather than source order, because the two orders
          differ: on a phone the figure has to come between the CTA and the
          supporting facts, on a desktop it sits beside both. */}
      <div className="grid grid-cols-1 items-start gap-10 lg:grid-cols-[minmax(0,46fr)_minmax(0,54fr)] lg:gap-x-14 lg:gap-y-8">
        <div className="min-w-0 lg:col-start-1 lg:row-start-1">
          <Eyebrow>MXIK katalog auditi</Eyebrow>
          <h1 className="mt-3 text-[32px] leading-[1.08] sm:text-[44px] lg:text-[46px]">
            Katalogingizdagi xavfli MXIK kodlarini toping.
          </h1>
          <p className="mt-4 max-w-[52ch] text-[17px] leading-relaxed text-ink-soft">
            Excel yoki CSV katalogni yuklang. Har bir qator rasmiy tasniflagich
            bilan solishtiriladi: xato kodlar ajratiladi, oʻrniga mos kod taklif
            qilinadi. Qarorni siz qabul qilasiz.
          </p>

          <CtaPair className="mt-7" />
        </div>

        <div className="min-w-0 lg:col-start-2 lg:row-start-1 lg:row-span-2">
          <TransformFigure />
        </div>

        {/* Typographic, not badges: a rule and four facts, like a byline. Spacing
            separates them rather than dots, which strand at the start of a
            wrapped line. */}
        <ul className="grid list-none grid-cols-2 gap-x-6 gap-y-2.5 border-t border-rule p-0 pt-4 text-[13px] text-ink-soft sm:flex sm:flex-wrap sm:gap-x-7 lg:col-start-1 lg:row-start-2">
          {FACTS.map((fact) => (
            <li key={fact} className="tnum">
              {fact}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
