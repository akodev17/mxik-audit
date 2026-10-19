'use client';

import { useI18n } from '@/lib/locale-client';
import type { UnitAdvice } from '@/lib/unit-advice';

/** Suggestions only: the unit the code is bound to and the packaging read from the name. */
export function UnitAdviceBox({ advice }: { advice: UnitAdvice }) {
  const { ta } = useI18n();
  if (!advice.unit && !advice.packaging) return null;
  return (
    <section className="space-y-2 rounded-ctl border border-line bg-surface p-3">
      <h3 className="text-small font-semibold text-fg">{ta.unitAdvice.title}</h3>
      {advice.unit ? <p className="text-small">{ta.unitAdvice.unit(advice.unit.current, advice.unit.suggested)}</p> : null}
      {advice.packaging ? (
        <p className="text-small">
          {ta.unitAdvice.packaging(advice.packaging.values.join(', '))}
          {advice.packaging.codeContainer ? <span className="text-muted"> {ta.unitAdvice.container(advice.packaging.codeContainer)}</span> : null}
        </p>
      ) : null}
      <p className="text-micro text-muted">{ta.unitAdvice.hint}</p>
    </section>
  );
}
