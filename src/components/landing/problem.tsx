import { CodeDecoder } from './code-decoder';
import { CONTAINER } from './container';
import { PortalExamples } from './portal-examples';

// Each row is one thing that changes. Wording stays within what the product does today.
const ROWS = [
  { what: 'Nimani tekshirasiz', before: 'Bitta kodni, portalda qidirib.', after: 'Butun katalogni, qator-qatorga.' },
  { what: 'Kod qanday oʻqiladi', before: '17 raqam, koʻzga toʻgʻri koʻrinadi.', after: 'Guruh, sinf, pozitsiya, subpozitsiya boʻyicha: ajralgan joyi belgilanadi.' },
  { what: 'Taklif', before: 'Qidiruv natijasi soʻrov yozilishiga bogʻliq.', after: 'Yonida tasniflagichdagi oʻrni va moslik darajasi turadi.' },
  { what: 'Qaror', before: 'Qayerda yozilgani nomaʼlum.', after: 'Kim va qachon qabul qilgani tarixda qoladi.' },
  { what: 'Natija', before: 'Faylni qoʻlda qayta yigʻasiz.', after: 'Asl ustunlar tartibida, tasdiqlangan kodlar joyida.' },
] as const;

// Section 2: the dangerous code looks fine; here is the same work done by hand and with Tasnivo.
export function Problem() {
  return (
    <section aria-labelledby="why-title" className="py-20 sm:py-28">
      <div className={CONTAINER}>
        <div className="grid grid-cols-1 gap-x-14 gap-y-10 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <p className="text-[13px] font-medium uppercase tracking-wide text-lp-brand-ink">Muammo</p>
            <h2 id="why-title" className="lp-display mt-4 text-[clamp(1.875rem,3.8vw,2.75rem)]">
              Eng xavfli kod — <em>toʻgʻri koʻrinadigani</em>
            </h2>
            <p className="mt-6 text-[18px] text-lp-muted">
              Boʻsh katakni darrov koʻrasiz. Boshqa tovarning haqiqiy kodi esa 17 raqami bilan joyida
              turadi. Xatoni faqat kodni tasniflagich darajalari boʻyicha oʻqib topish mumkin — Tasnivo
              har bir qatorni shunday tekshiradi.
            </p>
          </div>
          <div className="min-w-0 lg:col-span-7"><CodeDecoder /></div>
        </div>

        <div className="mt-24">
          <h3 className="lp-display text-[clamp(1.5rem,3vw,2rem)]">Shu ish qoʻlda va Tasnivo bilan</h3>
          <div className="mt-8 overflow-hidden rounded-lp border border-lp-line bg-lp-base">
            <div className="hidden grid-cols-[11rem_1fr_1fr] border-b border-lp-line bg-lp-surface text-[14px] font-medium sm:grid">
              <span className="px-5 py-3" />
              <span className="border-l border-lp-line px-5 py-3 text-lp-muted">Qoʻlda</span>
              <span className="border-l border-lp-line bg-lp-brand-fill px-5 py-3 text-lp-brand-ink">Tasnivo bilan</span>
            </div>
            <dl>
              {ROWS.map((r) => (
                <div key={r.what} className="grid grid-cols-1 border-b border-lp-line last:border-b-0 sm:grid-cols-[11rem_1fr_1fr]">
                  <dt className="px-5 pt-4 text-[15px] font-medium sm:py-4">{r.what}</dt>
                  <dd className="px-5 py-1 text-[16px] text-lp-muted sm:border-l sm:border-lp-line sm:py-4">
                    <span className="mr-2 text-[13px] sm:hidden">Qoʻlda:</span>{r.before}
                  </dd>
                  <dd className="bg-lp-base px-5 pb-4 pt-1 text-[16px] text-lp-ink sm:border-l sm:border-lp-line sm:py-4">
                    <span className="mr-2 text-[13px] text-lp-brand-ink sm:hidden">Tasnivo:</span>{r.after}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </div>

        <div className="mt-20"><PortalExamples /></div>
      </div>
    </section>
  );
}
