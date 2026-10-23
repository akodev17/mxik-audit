'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { fmtNumber } from '@tasnivo/i18n/format';
import { useI18n } from '@/lib/locale-client';
import type { CompletionSummary } from '@/lib/catalogs/types';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { cx } from '@/ui/cx';
import { IconBook, IconChevron, IconList, IconSuccess, IconTable } from '@/ui/icons';
import { typeLabels, typeTone } from '@/ui/labels';
import { Stat } from '@/ui/stat';
import { Notice } from './notice';
import { StepCard, StepFooter } from './step-card';

type Action = { href: string; label: string; hint: string; icon: ReactNode; lead?: boolean };

/**
 * A next step as a row: the title is the link (its name is the title alone), stretched over the
 * whole row so the hint and icon are clickable too.
 */
function NextAction({ href, label, hint, icon, lead }: Action) {
  return (
    <li className={cx('relative flex items-center gap-3 px-4 py-3 transition-colors duration-(--duration-fast) hover:bg-surface', lead && 'bg-brand-tint hover:bg-brand-tint')}>
      <span aria-hidden className={cx('grid size-9 shrink-0 place-items-center rounded-md', lead ? 'bg-brand text-on-fill' : 'bg-sunken text-muted')}>{icon}</span>
      <span className="min-w-0 flex-1">
        <Link href={href} className={cx('font-medium after:absolute after:inset-0 after:rounded-[inherit] hover:underline', lead ? 'text-brand-ink' : 'text-fg')}>{label}</Link>
        <span className="block text-small text-muted">{hint}</span>
      </span>
      <IconChevron size={16} className="shrink-0 text-subtle" />
    </li>
  );
}

/** Step 6: what the audit found (counts, finding types linking to the workspace filters) and where to go next. */
export function DoneStep({ catalogId, summary, onAnother }: { catalogId: string; summary: CompletionSummary; onAnother: () => void }) {
  const { locale, t, ta } = useI18n();
  const d = ta.importX.done;
  const f = ta.importX.flow;
  const n = (v: number): string => fmtNumber(locale, v);
  const types = typeLabels(t);
  const workspace = `/catalogs/${catalogId}`;
  const actions: Action[] = [
    { href: workspace, label: d.openWorkspace, hint: f.nextWorkspace, icon: <IconTable size={18} />, lead: true },
    { href: `${workspace}/report`, label: f.nextReport, hint: f.nextReportHint, icon: <IconBook size={18} /> },
    ...(summary.previousId ? [{ href: `${workspace}/diff`, label: d.openDiff, hint: f.nextDiffHint, icon: <IconList size={18} /> }] : []),
  ];

  return (
    <StepCard
      titleId="done-title" title={d.title} hint={summary.riskyRows > 0 ? d.found(summary.riskyRows, summary.rows) : d.clean(summary.rows)}
      icon={<span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-full bg-good-tint text-good-ink"><IconSuccess size={20} /></span>}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label={d.rows} value={n(summary.rows)} />
        <Stat label={d.risky} value={n(summary.riskyRows)} tone={summary.riskyRows > 0 ? 'danger' : 'good'} href={workspace} />
        <Stat
          label={d.carried} value={n(summary.carried)}
          href={summary.carried > 0 && summary.previousId ? `${workspace}/diff` : undefined}
        />
      </div>

      {summary.byType.length > 0 ? (
        <div>
          <h3 className="text-data font-semibold">{d.byType}</h3>
          <p className="mt-0.5 text-small text-muted">{f.byTypeHint}</p>
          <ul className="mt-3 flex flex-wrap gap-2">
            {summary.byType.map((b) => (
              <li key={b.type}>
                <Link
                  href={`${workspace}?type=${b.type}`}
                  className="inline-flex rounded-full transition-transform duration-(--duration-fast) hover:-translate-y-px motion-reduce:transition-none"
                >
                  <Badge tone={typeTone(b.type, 'high')} className="px-2.5 py-1 text-small">
                    {types[b.type] ?? b.type}: <span className="font-semibold tabular-nums">{n(b.count)}</span>
                  </Badge>
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

      <div>
        <h3 className="text-data font-semibold">{f.doneNext}</h3>
        <ul className="mt-2 divide-y divide-line overflow-hidden rounded-md border border-line">
          {actions.map((a) => <NextAction key={a.href} {...a} />)}
        </ul>
      </div>

      <StepFooter>
        <Button variant="ghost" onClick={onAnother}>{d.another}</Button>
      </StepFooter>
    </StepCard>
  );
}
