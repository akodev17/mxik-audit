import { SHOW_LEGAL_223 } from './config';
import { consequences } from './data';
import { Eyebrow, WRAP } from './primitives';

export function Consequences() {
  const cards = consequences(SHOW_LEGAL_223);
  const sourced = cards.filter((c) => c.sources.length > 0).length;

  return (
    <section className="border-t border-rule py-14 sm:py-16">
      <div className={WRAP}>
        <Eyebrow>Oqibat</Eyebrow>
        <h2 className="mt-3 max-w-[26ch] text-[27px] leading-tight sm:text-[32px]">
          Notoʻgʻri kod nimaga olib keladi
        </h2>

        <div className="mt-9 grid grid-cols-1 gap-x-12 gap-y-9 sm:grid-cols-2">
          {cards.map((c) => (
            <div key={c.title} className="border-t-2 border-risk pt-4">
              <h3 className="text-[19px]">{c.title}</h3>
              <p className="mt-2 max-w-[46ch] text-sm text-ink-soft">{c.body}</p>
              {c.sources.length > 0 ? (
                <ul className="mt-3 list-none space-y-1.5 p-0 text-xs text-ink-faint">
                  {c.sources.map((s) => (
                    <li key={s.href}>
                      <a href={s.href} target="_blank" rel="noopener noreferrer" className="underline">
                        {s.label}
                      </a>
                      {' — '}
                      {s.note}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-xs text-ink-faint">{c.note}</p>
              )}
            </div>
          ))}
        </div>

        <p className="mt-9 max-w-[68ch] text-xs text-ink-faint">
          {sourced === 1
            ? 'Yuqoridagilardan faqat birinchisi normativ hujjat va rasmiy bayonotga tayanadi, havolalari keltirilgan. '
            : 'Havolasi bor bandlar normativ hujjat yoki rasmiy bayonotga tayanadi. '}
          Qolganlari — amaliyot va tizim mexanizmi tavsifi; biz ularga modda
          raqamini biriktirmaymiz va yuridik xulosa sifatida taqdim etmaymiz.
        </p>
      </div>
    </section>
  );
}
