import { CodeDecoder } from './code-decoder';
import { CONTAINER } from './container';
import { PortalExamples } from './portal-examples';

// Section 2: the dangerous code is the one that looks fine.
export function WhyCodes() {
  return (
    <section aria-labelledby="why-title" className="py-16 sm:py-24">
      <div className={CONTAINER}>
        <div className="max-w-[44rem]">
          <h2 id="why-title" className="text-[30px] sm:text-[42px]">Eng xavfli kod — toʻgʻri koʻrinadigani</h2>
          <p className="mt-4 text-[18px] text-lp-muted">
            Boʻsh katakni darrov koʻrasiz. Boshqa tovarning haqiqiy kodi esa 17 raqami bilan joyida
            turadi. Xatoni faqat kodni tasniflagich darajalari boʻyicha oʻqib topish mumkin — tizim
            har bir qatorni shunday tekshiradi.
          </p>
        </div>
        <div className="mt-10"><CodeDecoder /></div>
        <div className="mt-16"><PortalExamples /></div>
      </div>
    </section>
  );
}
