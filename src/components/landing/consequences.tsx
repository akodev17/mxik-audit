import { CONSEQUENCES } from './data';
import { Eyebrow, WRAP } from './primitives';

export function Consequences() {
  return (
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
  );
}
