'use client';

import { decisionSourceLabel, isAutomatic } from '@/lib/workspace-url';
import { fmtDateTime } from '@tasnivo/i18n/format';
import { useI18n } from '@/lib/locale-client';
import type { RowDetail } from './ws-types';
import type { GridRow } from './ws-types';
import { StatusChip, StatusIcon } from '@/ui/badge';
import { decisionText } from './ws-text';

/** Who decided this row, how and when; automatic decisions say so plainly. */
export function DecisionInfo({ row, detail }: { row: GridRow; detail: RowDetail }) {
  const { ta, locale } = useI18n();
  const x = ta.wsX.decided;
  if (row.decision === 'pending') return null;
  // The grid may know a newer decision than the loaded detail (decided just now).
  const fresh = detail.decision === row.decision;
  const source = fresh ? detail.decisionSource : row.decisionSource;
  const who = fresh ? detail.decidedBy : null;
  const when = fresh && detail.decidedAt ? fmtDateTime(locale, detail.decidedAt) : null;
  const tone = row.decision === 'accepted' ? 'good' : 'neutral';
  const auto = isAutomatic(source);
  return (
    <section className="rounded-ctl border border-line bg-surface p-3 text-small">
      <h3 className="sr-only">{x.title}</h3>
      <div className="flex flex-wrap items-center gap-2">
        <StatusChip tone={tone} icon={<StatusIcon tone={tone} size={12} />}>{decisionText(row, ta)}</StatusChip>
        {source ? <span className="font-medium text-fg">{auto ? `${x.automatic}: ` : ''}{decisionSourceLabel(source, ta)}</span> : null}
      </div>
      {source === 'carry_over' && who ? <p className="mt-1 text-muted">{ta.matchX.carriedFrom(who)}</p> : null}
      {when ? <p className="mt-1 text-muted">{x.by(source === 'dictionary_auto' ? x.system : who ?? x.removedUser, when)}</p> : null}
    </section>
  );
}
