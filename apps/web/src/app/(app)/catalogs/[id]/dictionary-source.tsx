'use client';

import Link from 'next/link';
import { fmtDate, fmtNumber } from '@tasnivo/i18n/format';
import { useI18n } from '@/lib/locale-client';
import { Badge, StatusIcon } from '@/ui/badge';
import { useProvenance } from './use-provenance';

/**
 * The firm dictionary entry behind a reused suggestion: the product name it was taught from, who
 * first taught it and who last changed or confirmed it, its review state, and a link to it on
 * /dictionary. Nothing for a member scoped to some clients (the entry holds every client's names).
 */
export function DictionarySource({ findingId }: { findingId: string }) {
  const { ta, locale } = useI18n();
  const x = ta.wsX.dictSource;
  const d = ta.wsX.dict;
  const entry = useProvenance(findingId, true)?.dictionary ?? null;
  if (!entry) return null;
  const who = (email: string | null): string => email ?? x.unknown;
  return (
    <section className="space-y-1 rounded-lg border border-line bg-surface p-3 text-small">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="font-semibold text-fg">{x.title}</h4>
        {entry.disputedAt ? <Badge tone="danger" icon={<StatusIcon tone="danger" size={12} />} title={d.disputedHint}>{d.disputed}</Badge> : null}
        {!entry.disputedAt && entry.needsReconfirm ? <Badge tone="warn" icon={<StatusIcon tone="warn" size={12} />} title={d.needsReconfirmHint}>{d.needsReconfirm}</Badge> : null}
      </div>
      <p className="break-words text-fg">{x.learnedFrom(entry.label)}</p>
      <p className="text-muted">{entry.confirmations > 0 ? x.confirmations(fmtNumber(locale, entry.confirmations), entry.confirmations) : x.noConfirmations}</p>
      <p className="text-muted">{x.first(who(entry.createdBy), fmtDate(locale, entry.createdAt))}</p>
      <p className="text-muted">
        {x.last(who(entry.updatedBy), fmtDate(locale, entry.updatedAt))}
        {entry.source && d.sourceLabel[entry.source] ? ` · ${d.sourceLabel[entry.source]}` : ''}
      </p>
      {entry.disputedAt ? <p className="text-muted">{d.disputedBy(who(entry.disputedBy), fmtDate(locale, entry.disputedAt))}</p> : null}
      <Link href={`/dictionary?${new URLSearchParams({ q: entry.label.slice(0, 80) })}`} className="inline-block font-medium text-brand-ink hover:underline">{x.open}</Link>
    </section>
  );
}
