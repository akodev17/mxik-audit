import { DELIVERABLES } from './data';
import { Eyebrow, WRAP } from './primitives';

export function Deliverables() {
  return (
    <section className="border-t border-rule py-14 sm:py-16">
      <div className={WRAP}>
        <Eyebrow>Natija</Eyebrow>
        <h2 className="mt-3 text-[27px] leading-tight sm:text-[32px]">Sizga nima qaytadi?</h2>

        <dl className="mt-9 grid grid-cols-1 gap-x-12 gap-y-8 sm:grid-cols-2">
          {DELIVERABLES.map((d) => (
            <div key={d.title} className="border-t border-ink pt-4">
              <dt className="font-serif text-[19px]">{d.title}</dt>
              <dd className="mt-1.5 max-w-[46ch] text-sm text-ink-soft">{d.body}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
