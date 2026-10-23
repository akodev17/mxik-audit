'use client';

import Link from 'next/link';
import { fmtNumber } from '@tasnivo/i18n/format';
import { useI18n } from '@/lib/locale-client';
import type { CompletionSummary } from '@/lib/catalogs/types';
import { Badge } from '@/ui/badge';
import { Button, ButtonLink } from '@/ui/button';
import { typeLabels, typeTone } from '@/ui/labels';
import { Stat } from '@/ui/stat';
import { Notice } from './notice';

/** Step 6: what the audit found, what carried over, and where to go next. */
export function DoneStep({ catalogId, summary, onAnother }: { catalogId: string; summary: CompletionSummary; onAnother: () => void }) {
  const { locale, t, ta } = useI18n();
  const d = ta.importX.done;
  const n = (v: number): string => fmtNumber(locale, v);
  const types = typeLabels(t);

  return (
    <section aria-labelledby="done-title" className="space-y-4">
      <h2 id="done-title" className="text-section">{d.title}</h2>
      <p className="text-body">{summary.riskyRows > 0 ? d.found(summary.riskyRows, summary.rows) : d.clean(summary.rows)}</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label={d.rows} value={n(summary.rows)} />
        <Stat label={d.risky} value={n(summary.riskyRows)} tone={summary.riskyRows > 0 ? 'danger' : 'good'} href={`/catalogs/${catalogId}`} />
        <Stat
          label={d.carried} value={n(summary.carried)}
          href={summary.carried > 0 && summary.previousId ? `/catalogs/${catalogId}/diff` : undefined}
        />
      </div>
      {summary.byType.length > 0 ? (
        <div>
          <h3 className="mb-2 text-data font-semibold">{d.byType}</h3>
          <ul className="flex flex-wrap gap-2">
            {summary.byType.map((b) => (
              <li key={b.type}>
                <Link href={`/catalogs/${catalogId}?type=${b.type}`} className="inline-flex rounded-full">
                  <Badge tone={typeTone(b.type, 'high')}>{types[b.type] ?? b.type}: {n(b.count)}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {summary.notRead > 0 || summary.dropped > 0 ? (
        <Notice tone="warn">
          {summary.notRead > 0 ? <p>{d.notRead(summary.notRead)}</p> : null}
          {summary.dropped > 0 ? <p>{d.dropped(summary.dropped)}</p> : null}
        </Notice>
      ) : null}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button variant="ghost" onClick={onAnother}>{d.another}</Button>
        {summary.previousId ? <ButtonLink href={`/catalogs/${catalogId}/diff`}>{d.openDiff}</ButtonLink> : null}
        <ButtonLink href={`/catalogs/${catalogId}`} variant="primary">{d.openWorkspace}</ButtonLink>
      </div>
    </section>
  );
}
