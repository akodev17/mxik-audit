import { SHOW_LEGAL_223 } from './config';
import { consequences } from './data';
import { Chapter } from './primitives';

/* Set as a memo, not as cards: numbered clauses, each with its source in the
   margin where a lawyer would look for it. Verification status of every
   clause is documented on `consequences` in data.ts. */
export function Consequences() {
  const cards = consequences(SHOW_LEGAL_223);
  const sourced = cards.filter((c) => c.sources.length > 0).length;

  return (
    <Chapter n="03" label="Oqibat">
      <h2 className="max-w-[24ch] text-[28px] leading-tight sm:text-[34px]">
        Notoʻgʻri kod nimaga olib keladi
      </h2>

      <ol className="mt-8 list-none border-t border-ink p-0">
        {cards.map((c, i) => (
          <li
            key={c.title}
            className="grid grid-cols-[2rem_minmax(0,1fr)] gap-x-4 gap-y-3 border-b border-rule py-6 md:grid-cols-[2.5rem_minmax(0,1fr)_minmax(0,17rem)] md:gap-x-8"
          >
            <span className="font-serif text-[24px] leading-none text-ink-faint tnum">{i + 1}</span>
            <div className="min-w-0">
              <h3 className="text-[20px] leading-snug">{c.title}</h3>
              <p className="mt-2 max-w-[58ch] text-[15px] text-ink-soft">{c.body}</p>
            </div>
            <div className="col-start-2 text-[13px] leading-relaxed text-ink-soft md:col-start-3 md:border-l md:border-rule md:pl-5">
              {c.sources.length > 0 ? (
                <ul className="list-none space-y-2 p-0">
                  {c.sources.map((s) => (
                    <li key={s.href}>
                      <a href={s.href} target="_blank" rel="noopener noreferrer" className="text-ink underline underline-offset-4">
                        {s.label}
                      </a>
                      <span className="block">{s.note}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="italic">{c.note}</p>
              )}
            </div>
          </li>
        ))}
      </ol>

      <p className="mt-5 max-w-[80ch] text-[13px] text-ink-soft">
        {sourced === 1
          ? 'Havolasi bor band normativ hujjat va rasmiy bayonotga tayanadi. '
          : 'Havolasi bor bandlar normativ hujjat yoki rasmiy bayonotga tayanadi. '}
        Qolganlari — amaliyot va tizim mexanizmi tavsifi; ularga modda raqamini
        biriktirmaymiz va yuridik xulosa sifatida taqdim etmaymiz.
      </p>
    </Chapter>
  );
}
