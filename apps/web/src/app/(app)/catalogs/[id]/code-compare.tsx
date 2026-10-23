'use client';

import type { ReactNode } from 'react';
import { useI18n } from '@/lib/locale-client';
import type { CodeView } from './ws-types';
import { cx } from '@/ui/cx';
import { IconChevron } from '@/ui/icons';

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
    <section className="rounded-lg border border-line p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-small font-semibold text-muted">{title}</h4>
        {action}
      </div>
      {view ? <Blocks view={view} from={from} /> : <p className="text-small text-muted">{empty}</p>}
      {state ? <p className="mt-2 text-micro font-medium text-danger-ink">{state}</p> : null}
    </section>
  );
}

/** A code in mono with its five blocks spaced apart; blocks from `from` on are marked as the part that changes. */
function SplitCode({ view, from }: { view: CodeView; from: number }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-1 rounded-sm bg-sunken px-1.5 py-0.5 font-mono text-mono text-fg">
      {view.blocks.map((b, i) => (
        <span key={i} className={cx(from !== -1 && i >= from && 'rounded-xs text-warn-ink underline decoration-warn decoration-2 underline-offset-[3px]', b.missing && 'text-danger-ink')}>{b.digits}</span>
      ))}
    </span>
  );
}

type Side = { label: string; view: CodeView | null; empty: string; extra?: ReactNode };

/**
 * The drawer's header comparison: the current code and the proposed one side by side (stacked in a
 * narrow panel), each with its classifier name; the blocks that change are underlined in both.
 */
export function CodePair({ left, right }: { left: Side; right: Side }) {
  const { ta } = useI18n();
  const from = divergence(left.view, right.view);
  const side = (s: Side, accent: boolean) => {
    const state = s.view?.state === 'archived' ? ta.wsX.codeState.archived : s.view?.state === 'unknown' ? ta.wsX.codeState.unknown : null;
    return (
      <div className={cx('min-w-0 rounded-md border p-3', accent ? 'border-brand/40 bg-brand-tint/40' : 'border-line bg-surface')}>
        <p className="text-micro font-medium uppercase tracking-wide text-muted">{s.label}</p>
        {s.view ? (
          <>
            <p className="mt-1.5"><SplitCode view={s.view} from={from} /></p>
            <p className="mt-1 line-clamp-2 text-small text-fg" title={s.view.name}>{s.view.name}</p>
          </>
        ) : <p className="mt-1.5 text-small text-muted">{s.empty}</p>}
        {state ? <p className="mt-1 text-micro font-medium text-danger-ink">{state}</p> : null}
        {s.extra ? <div className="mt-2">{s.extra}</div> : null}
      </div>
    );
  };
  return (
    <div className="grid items-stretch gap-2 @[26rem]:grid-cols-[1fr_auto_1fr]">
      {side(left, false)}
      <span aria-hidden className="hidden place-items-center text-subtle @[26rem]:grid"><IconChevron size={16} /></span>
      {side(right, true)}
    </div>
  );
}
