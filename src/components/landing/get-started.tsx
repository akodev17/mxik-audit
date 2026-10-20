import { LeadForm } from '@/app/lead-form';
import { ButtonLink } from './button';
import { DEMO_URL } from './config';
import { CONTAINER } from './container';
import { tight } from './tight';
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

      <section aria-labelledby="audit-title" className="bg-lp-night py-20 text-white sm:py-28">
        <div className={`${CONTAINER} grid grid-cols-1 gap-x-16 gap-y-12 lg:grid-cols-12`}>
          <div className="lg:col-span-6">
            <p className="lp-mono text-[13px] uppercase tracking-[0.1em] text-[#8fb0ff]">Boshlash</p>
            <h2 id="audit-title" className="lp-serif mt-4 text-[clamp(2.5rem,5.5vw,4.25rem)]">
              Faylingizni yuboring — <em className="!text-[#8fb0ff]">riskli pozitsiyalar</em> {tight('roʻyxatini oling')}
            </h2>
            <p className="mt-6 max-w-[34rem] text-[18px] text-lp-night-muted">
              Ikki maydon, roʻyxatdan oʻtish yoʻq. Faylni koʻrib chiqamiz va bir ish kuni ichida
              riskli pozitsiyalar roʻyxatini yuboramiz. {DATA_FLOW.purpose} {DATA_FLOW.deletion}
            </p>
          </div>
          <div id="audit" className="scroll-mt-6 rounded-lp bg-lp-base p-6 text-lp-ink sm:p-8 lg:col-span-6">
            <h3 className="lp-serif text-[2rem]">Katalogni bepul tekshirtirish</h3>
            <div className="mt-5"><LeadForm /></div>
          </div>
        </div>
      </section>
    </>
  );
}
