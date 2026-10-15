import { LeadForm } from '@/app/lead-form';
import { ButtonLink } from './button';
import { DEMO_URL } from './config';
import { CONTAINER } from './container';
import { DATA_FLOW } from './data';
import { Faq } from './faq';
import { Pricing } from './pricing';

// Section 6: price, the free audit form, the demo when configured, then questions.
export function GetStarted() {
  return (
    <section aria-label="Narxlar va bepul tekshiruv" className="py-16 sm:py-24">
      <div className={CONTAINER}>
        <div className="grid grid-cols-1 gap-x-16 gap-y-14 lg:grid-cols-2">
          <div>
            <Pricing />
            {DEMO_URL ? (
              <div className="mt-10 bg-lp-surface p-6">
                <h3 className="text-[22px]">Avval demoda koʻring</h3>
                <p className="mt-2 text-[17px]">
                  Yuqoridagi katalog, lekin ilovaning oʻzida: hisobot, takliflarni qabul qilish va
                  rad etish, tuzatilgan Excelni yuklab olish.
                </p>
                <ul className="mt-3 space-y-1 text-[16px] text-lp-muted">
                  <li>Roʻyxatdan oʻtmasdan, bitta bosishda.</li>
                  <li>Har kim oʻz nusxasini oladi, qarorlaringizni boshqalar koʻrmaydi.</li>
                  <li>Nusxa 24 soatdan keyin oʻchadi, demoda fayl yuklash yoʻq.</li>
                </ul>
                <ButtonLink href={DEMO_URL} variant="secondary" className="mt-5">Demoni ochish</ButtonLink>
              </div>
            ) : null}
          </div>

          <div id="audit" className="scroll-mt-6 rounded-lp border-2 border-lp-ink p-6 sm:p-8">
            <h2 className="text-[28px] sm:text-[34px]">Katalogni bepul tekshirtirish</h2>
            <p className="mt-3 text-[17px] text-lp-muted">
              Ikki maydon, roʻyxatdan oʻtish yoʻq. Faylni koʻrib chiqamiz va bir ish kuni ichida riskli
              pozitsiyalar roʻyxatini yuboramiz. {DATA_FLOW.purpose} {DATA_FLOW.deletion}
            </p>
            <div className="mt-6"><LeadForm /></div>
          </div>
        </div>

        <div className="mt-20"><Faq /></div>
      </div>
    </section>
  );
}
