'use client';

import type { ReactNode } from 'react';
import { useI18n } from '@/lib/locale-client';
import type { CodeView } from '@/lib/row-detail';
import { cx } from '@/ui/cx';

/** Index of the first of the five blocks where two codes differ; -1 when equal. */
export function divergence(a: CodeView | null, b: CodeView | null): number {
  if (!a || !b) return -1;
  return a.blocks.findIndex((blk, i) => blk.digits !== b.blocks[i]?.digits);
}

function Blocks({ view, from }: { view: CodeView; from: number }) {
  const { ta } = useI18n();
  return (
    <ol className="space-y-1">
      {view.blocks.map((b, i) => {
        const differs = from !== -1 && i >= from;
        return (
          <li key={ta.drawer.levels[i]} className={cx('flex items-baseline gap-3 rounded-sm px-2 py-1', b.missing ? 'bg-danger-tint' : differs && 'bg-warn-tint')}>
            <span className="w-24 shrink-0 text-micro text-muted">{ta.drawer.levels[i]}</span>
            <span className="shrink-0 rounded-sm bg-sunken px-1.5 font-mono text-mono">{b.digits}</span>
            {b.missing
              ? <span className="min-w-0 truncate text-small font-medium text-danger-ink">{ta.wsX.drawer.missingLevel}</span>
              : <span className="min-w-0 truncate text-small text-fg" title={b.name ?? undefined}>{b.name ?? '—'}</span>}
          </li>
        );
      })}
    </ol>
  );
}

type Props = { title: string; view: CodeView | null; other: CodeView | null; empty: string; action?: ReactNode };

/**
 * A code split into guruh / sinf / pozitsiya / subpozitsiya / brend; levels from the first
 * difference are tinted, and a level the classifier does not have says so.
 */
export function CodeCompare({ title, view, other, empty, action }: Props) {
  const { ta } = useI18n();
  const from = divergence(view, other);
  const state = view?.state === 'archived' ? ta.wsX.codeState.archived : view?.state === 'unknown' ? ta.wsX.codeState.unknown : null;
  return (
    <section className="rounded-ctl border border-line p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-small font-semibold text-muted">{title}</h3>
        {action}
      </div>
      {view ? <Blocks view={view} from={from} /> : <p className="text-small text-muted">{empty}</p>}
      {state ? <p className="mt-2 text-micro font-medium text-danger-ink">{state}</p> : null}
    </section>
  );
}
