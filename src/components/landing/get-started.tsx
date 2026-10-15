import { LeadBlock } from './lead-section';
import { Pricing } from './pricing';
import { WRAP } from './primitives';

/* The last section: what it costs, then the form. Pricing comes first so the
   request is made knowing the price. */
export function GetStarted() {
  return (
    <section id="narxlar" className="scroll-mt-4 border-t border-rule bg-paper-tint py-14 sm:py-16">
      <div className={`${WRAP} space-y-14 sm:space-y-16`}>
        <Pricing />
        <div className="border-t border-rule pt-14 sm:pt-16">
          <LeadBlock />
        </div>
      </div>
    </section>
  );
}
