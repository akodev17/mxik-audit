'use client';

import { useI18n } from '@/lib/locale-client';
import type { UnitAdvice } from '@/lib/unit-advice';
import { containerLabel, packagingLabel, unitLabel } from './unit-label';

/** Suggestions only: the unit the code is bound to and the packaging read from the name, in the viewer's language. */
export function UnitAdviceBox({ advice }: { advice: UnitAdvice }) {
  const { ta, locale } = useI18n();
  if (!advice.unit && !advice.packaging) return null;
  return (
    <section className="space-y-2 rounded-ctl border border-line bg-surface p-3">
      <h3 className="text-small font-semibold text-fg">{ta.unitAdvice.title}</h3>
      {/* The row's own unit stays as the file has it. */}
      {advice.unit ? <p className="text-small">{ta.unitAdvice.unit(advice.unit.current, unitLabel(locale, advice.unit.suggested))}</p> : null}
      {advice.packaging ? (
        <p className="text-small">
          {ta.unitAdvice.packaging(advice.packaging.values.map((v) => packagingLabel(locale, v)).join(', '))}
          {advice.packaging.codeContainer ? <span className="text-muted"> {ta.unitAdvice.container(containerLabel(locale, advice.packaging.codeContainer))}</span> : null}
        </p>
      ) : null}
      <p className="text-micro text-muted">{ta.unitAdvice.hint}</p>
    </section>
  );
}
