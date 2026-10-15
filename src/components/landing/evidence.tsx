import { EVIDENCE_ROWS, HEADLINE_EVIDENCE, SNAPSHOT } from './data';
import { Eyebrow, WRAP } from './primitives';

/* The strongest asset in the project: not a claim that the portal is hard to
   use, a record of what its own search returns. */
export function Evidence() {
  return (
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
  );
}
