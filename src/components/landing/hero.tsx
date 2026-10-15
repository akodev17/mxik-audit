import { AUTOMATED_TESTS, CATALOG_CODES, nf } from './data';
import { TransformFigure } from './figures';
import { Cta, Eyebrow, WRAP } from './primitives';

/* Five seconds to answer one question: what do I upload and what do I get
   back. The figure answers the second half without a screenshot. */
export function Hero() {
  return (
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
  );
}
