import { LeadForm } from '@/app/lead-form';
import { ButtonLink } from './button';
import { DEMO_URL } from './config';
import { CONTAINER } from './container';
import { DATA_FLOW } from './data';
import { Faq } from './faq';
import { Pricing } from './pricing';

// Sections 8 and 9: price and questions on paper, then the closing call to action on the dark band.
export function GetStarted() {
  return (
    <>
      <section aria-label="Narxlar va savollar" className="py-20 sm:py-28">
        <div className={`${CONTAINER} grid grid-cols-1 gap-x-16 gap-y-16 lg:grid-cols-2`}>
          <div>
            <Pricing />
            {DEMO_URL ? (
              <div className="mt-10 border-l-2 border-lp-brand bg-lp-brand-fill/60 p-6">
                <h3 className="text-[20px] font-medium">Avval demoda koʻring</h3>
                <p className="mt-2 text-[16px]">
                  Yuqoridagi katalog, lekin ilovaning oʻzida: hisobot, takliflarni qabul qilish va
                  rad etish, tuzatilgan Excelni yuklab olish. Roʻyxatdan oʻtmasdan; nusxa 24 soatdan
                  keyin oʻchadi, demoda fayl yuklash yoʻq.
                </p>
                <ButtonLink href={DEMO_URL} variant="secondary" className="mt-5">Demoni ochish</ButtonLink>
              </div>
            ) : null}
          </div>
          <Faq />
        </div>
      </section>

      <section aria-labelledby="audit-title" className="border-y border-lp-line bg-lp-surface py-20 sm:py-28">
        <div className={`${CONTAINER} grid grid-cols-1 gap-x-16 gap-y-12 lg:grid-cols-12`}>
          <div className="lg:col-span-6">
            <p className="text-[13px] font-medium uppercase tracking-wide text-lp-brand-ink">Boshlash</p>
            <h2 id="audit-title" className="lp-display mt-4 text-[clamp(2rem,4.4vw,3rem)]">
              Faylingizni yuboring — <em className="">riskli pozitsiyalar</em> roʻyxatini oling
            </h2>
            <p className="mt-6 max-w-[34rem] text-[18px] text-lp-muted">
              Ikki maydon, roʻyxatdan oʻtish yoʻq. Faylni koʻrib chiqamiz va bir ish kuni ichida
              riskli pozitsiyalar roʻyxatini yuboramiz. {DATA_FLOW.purpose} {DATA_FLOW.deletion}
            </p>
          </div>
          <div id="audit" className="scroll-mt-6 rounded-lp border border-lp-line bg-lp-base p-6 text-lp-ink shadow-sm sm:p-8 lg:col-span-6">
            <h3 className="text-[1.375rem] font-semibold">Katalogni bepul tekshirtirish</h3>
            <div className="mt-5"><LeadForm /></div>
          </div>
        </div>
      </section>
    </>
  );
}
