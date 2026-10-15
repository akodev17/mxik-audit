import { PORTAL_CHECKED, PORTAL_EXAMPLES } from './data';
import { BeforeAfterFigure } from './figures';
import { SectionHead, WRAP } from './primitives';

/* Why the dangerous codes are the ones that look fine, then why the portal —
   the right tool for one code — is the wrong tool for a whole catalogue. */
export function Problem() {
  return (
    <section className="border-t border-rule py-14 sm:py-16">
      <div className={WRAP}>
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:gap-12">
          <div className="min-w-0">
            <SectionHead
              eyebrow="Muammo"
              title="Eng xavfli kod — normal koʻrinadigani"
              titleClass="max-w-[22ch]"
            />
            <div className="mt-4 max-w-[54ch] space-y-3 text-ink-soft">
              <p>
                Boʻsh katak darrov koʻzga tashlanadi. Haqiqiy, lekin boshqa tovarga
                tegishli kod esa mutlaqo normal koʻrinadi: 17 xona raqam joyida.
              </p>
              <p>
                Buni faqat kodni tasniflagichdagi nomi bilan solishtirib bilish
                mumkin. Qoʻlda bu — har bir qatorni portalda alohida qidirish degani,
                katalogda esa qatorlar minglab.
              </p>
            </div>
          </div>
          <div className="min-w-0">
            <BeforeAfterFigure />
          </div>
        </div>

        <div className="mt-14 border-t border-rule pt-10">
          <h3 className="max-w-[40ch] text-[21px] leading-snug">
            Portal kodni bittalab qidirish uchun. Katalogni ommaviy tekshirish uchun emas.
          </h3>
          <p className="mt-3 max-w-[62ch] text-sm text-ink-soft">
            Rasmiy tasniflagich — yagona manba, biz ham undan foydalanamiz. Lekin
            uning qidiruvi soʻrov qanday yozilganiga juda sezgir. Portal qidiruvi
            natijalari, {PORTAL_CHECKED} holatiga:
          </p>

          <dl className="mt-6 grid grid-cols-1 gap-px border border-rule bg-rule md:grid-cols-3">
            {PORTAL_EXAMPLES.map((e) => (
              <div key={e.query} className="bg-paper p-5">
                <dt>
                  <span className="break-words code text-[15px] font-medium">{e.query}</span>
                  <span className="mt-1 block text-xs text-ink-faint">{e.note}</span>
                </dt>
                <dd className="mt-4">
                  <span className="block text-[15px] text-risk">{e.result}</span>
                  {e.contrast ? (
                    <span className="mt-2 block text-xs text-ink-soft">
                      Taqqoslang: <span className="code">{e.contrast}</span>
                    </span>
                  ) : null}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </section>
  );
}
