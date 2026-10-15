import { PRICING } from './data';
import { Eyebrow, WRAP } from './primitives';

export function Pricing() {
  return (
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
  );
}
