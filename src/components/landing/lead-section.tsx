import { LeadForm } from '@/app/lead-form';
import { WRAP } from './primitives';

export function LeadSection() {
  return (
    <section id="audit" className="border-t border-rule bg-paper-tint py-14 sm:py-16">
      <div className={WRAP}>
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:gap-16">
          <div>
            <h2 className="max-w-[30ch] text-[27px] leading-tight sm:text-[32px]">
              Katalogingizni yuboring — riskli pozitsiyalar roʻyxatini bepul oling.
            </h2>
            <p className="mt-4 max-w-[52ch] text-ink-soft">
              Ikki maydon, roʻyxatdan oʻtish yoʻq. Faylni koʻrib chiqamiz va bir ish
              kuni ichida riskli pozitsiyalar roʻyxatini yuboramiz.
            </p>
            <ul className="mt-7 list-none space-y-2.5 p-0 text-sm text-ink-soft">
              {[
                'Excel (.xlsx) yoki CSV — ustunlar tartibi muhim emas',
                'Fayl faqat audit uchun ishlatiladi, uchinchi shaxslarga berilmaydi',
                'Istagan paytda oʻchirishimizni soʻrashingiz mumkin',
              ].map((line) => (
                <li key={line} className="flex gap-3">
                  <span aria-hidden="true" className="text-ok">
                    ✓
                  </span>
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="border border-rule bg-paper p-6 sm:p-7">
            <LeadForm />
          </div>
        </div>
      </div>
    </section>
  );
}
