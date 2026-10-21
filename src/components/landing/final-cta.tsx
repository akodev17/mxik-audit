import { LeadForm } from '@/app/lead-form';
import { DEMO_URL } from './config';
import { CONTAINER } from './container';
import { DATA_FLOW } from './data';

// The closing call to action: one blue panel on the grey canvas, the free-audit form as its single action.
export function FinalCta() {
  return (
    <section aria-labelledby="audit-title" className="bg-lp-surface px-3 py-16 sm:px-4 sm:py-24">
      <div className={CONTAINER}>
        <div className="grid grid-cols-1 gap-x-14 gap-y-10 overflow-hidden rounded-lp-xl bg-lp-brand p-6 text-white sm:p-10 lg:grid-cols-12 lg:items-center lg:p-14">
          <div className="lg:col-span-6">
            <h2 id="audit-title" className="lp-display text-[clamp(1.875rem,4vw,2.75rem)] font-bold">
              Faylingizni yuboring — riskli pozitsiyalar roʻyxatini oling
            </h2>
            <p className="mt-5 max-w-[34rem] text-[17px] leading-relaxed text-white/90">
              Ikki maydon, roʻyxatdan oʻtish yoʻq. Faylni koʻrib chiqamiz va bir ish kuni ichida
              riskli pozitsiyalar roʻyxatini yuboramiz. {DATA_FLOW.purpose} {DATA_FLOW.deletion}
            </p>
            {DEMO_URL ? (
              <p className="mt-6 text-[15px]">
                Avval demoda koʻrmoqchimisiz?{' '}
                <a href={DEMO_URL} className="font-medium underline underline-offset-4 hover:text-white/80">Demoni ochish</a>
              </p>
            ) : null}
          </div>
          <div id="audit" className="scroll-mt-6 rounded-lp-lg bg-lp-base p-6 text-lp-ink shadow-lg sm:p-8 lg:col-span-6">
            <h3 className="text-[1.25rem] font-semibold">Katalogni bepul tekshirtirish</h3>
            <div className="mt-5"><LeadForm /></div>
          </div>
        </div>
      </div>
    </section>
  );
}
