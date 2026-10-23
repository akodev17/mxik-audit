'use client';

import { useI18n } from '@/lib/locale-client';
import type { RowDetail, UnitAdvice } from './ws-types';

/** Suggestions only: the unit the code is bound to and the packaging read from the name, in the viewer's language (the API's labels). */
export function UnitAdviceBox({ advice, labels }: { advice: UnitAdvice; labels: RowDetail['labels'] }) {
  const { ta } = useI18n();
  if (!advice.unit && !advice.packaging) return null;
  return (
    <section className="space-y-2 rounded-ctl border border-line bg-surface p-3">
      <h3 className="text-small font-semibold text-fg">{ta.unitAdvice.title}</h3>
      {/* The row's own unit stays as the file has it. */}
      {advice.unit ? <p className="text-small">{ta.unitAdvice.unit(advice.unit.current, labels.units[advice.unit.suggested] ?? advice.unit.suggested)}</p> : null}
      {advice.packaging ? (
        <p className="text-small">
          {ta.unitAdvice.packaging(advice.packaging.values.map((v) => labels.packaging[v] ?? v).join(', '))}
          {advice.packaging.codeContainer ? <span className="text-muted"> {ta.unitAdvice.container(labels.containers[advice.packaging.codeContainer] ?? advice.packaging.codeContainer)}</span> : null}
        </p>
      ) : null}
      <p className="text-micro text-muted">{ta.unitAdvice.hint}</p>
    </section>
  );
}
