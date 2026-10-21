import { SHOW_LEGAL_223 } from './config';
import { CONTAINER } from './container';
import { consequences, type Consequence } from './data';

function Sources({ item }: { item: Consequence }) {
  return (
    <ul className="mt-4 space-y-3">
      {item.sources.map((s) => (
        <li key={s.href} className="text-[16px]">
          <a href={s.href} target="_blank" rel="noopener noreferrer" className="rounded-lp font-medium text-lp-brand-ink underline decoration-2 underline-offset-4 hover:text-lp-ink">
            {s.label}
          </a>
          <span className="block text-lp-muted">{s.note}</span>
        </li>
      ))}
    </ul>
  );
}

// Section 3: sourced items apart from practice descriptions, wording from data.ts.
export function Consequences() {
  const items = consequences(SHOW_LEGAL_223);
  const sourced = items.filter((c) => c.sources.length > 0);
  const practice = items.filter((c) => c.sources.length === 0);

  return (
    <section aria-labelledby="consequences-title" className="bg-lp-surface py-20 sm:py-28">
      <div className={CONTAINER}>
        <h2 id="consequences-title" className="lp-display max-w-[22ch] text-[clamp(1.875rem,3.8vw,2.75rem)]">Notoʻgʻri kod nimaga olib keladi</h2>

        <div className="mt-10 grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
          <div className="space-y-6">
            {sourced.map((c) => (
              <article key={c.title} className="border border-lp-line border-l-4 border-l-lp-brand bg-lp-base p-6 sm:p-8">
                <p className="text-[15px] font-medium text-lp-brand-ink">Manbaga tayanadi</p>
                <h3 className="mt-2 text-[24px] sm:text-[28px]">{c.title}</h3>
                <p className="mt-3 max-w-[60ch] text-[18px]">{c.body}</p>
                <Sources item={c} />
              </article>
            ))}
          </div>

          <div>
            <p className="text-[16px] font-medium">Amaliyot tavsifi — modda raqamisiz</p>
            <ul className="mt-4 divide-y divide-lp-line border-y border-lp-line">
              {practice.map((c) => (
                <li key={c.title} className="py-5">
                  <h3 className="text-[20px]">{c.title}</h3>
                  <p className="mt-2 text-[17px]">{c.body}</p>
                  <p className="mt-2 text-[15px] text-lp-muted">{c.note}</p>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <p className="mt-8 max-w-[72ch] text-[15px] text-lp-muted">
          {sourced.length === 1
            ? 'Havolasi bor band normativ hujjat va rasmiy bayonotga tayanadi. '
            : 'Havolasi bor bandlar normativ hujjat yoki rasmiy bayonotga tayanadi. '}
          Qolganlari amaliyot va
          tizim mexanizmi tavsifi: ularga modda raqamini biriktirmaymiz va yuridik xulosa sifatida
          taqdim etmaymiz.
        </p>
      </div>
    </section>
  );
}
