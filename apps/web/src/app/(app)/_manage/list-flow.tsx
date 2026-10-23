'use client';

import type { ReactNode } from 'react';
import { useI18n } from '@/lib/locale-client';
import { Stepper } from '@/ui/stepper';

/** File → columns → result: the stages a purchase, cheque or sales list goes through, above the step's card. */
export function ListFlow({ step, children }: { step: 0 | 1 | 2; children: ReactNode }) {
  const { ta } = useI18n();
  const s = ta.mgX.clients.upload.steps;
  return (
    <div className="space-y-4">
      <Stepper stages={[s.file, s.columns, s.result]} current={step} />
      {children}
    </div>
  );
}
