import { Faq } from './faq';
import { LeadBlock } from './lead-section';
import { Pricing } from './pricing';
import { WRAP } from './primitives';

/* The last section: what it costs, the form, and the questions people ask
   before sending a file. Pricing comes first so the request is made knowing
   the price. */
export function GetStarted() {
  return (
    <section id="narxlar" className="scroll-mt-4 border-t border-rule bg-paper-tint py-14 sm:py-16">
      <div className={WRAP}>
        <Pricing />
        <div className="mt-14 border-t border-rule pt-14 sm:mt-16 sm:pt-16">
          <LeadBlock />
        </div>
        <div className="mt-14 border-t border-rule pt-14 sm:mt-16 sm:pt-16">
          <Faq />
        </div>
      </div>
    </section>
  );
}
