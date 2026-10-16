import { ta } from '@/lib/i18n-app';
import type { CodeView } from '@/lib/row-detail';

/** Index of the first of the five blocks where two codes differ; -1 when equal. */
export function divergence(a: CodeView | null, b: CodeView | null): number {
  if (!a || !b) return -1;
  return a.blocks.findIndex((blk, i) => blk.digits !== b.blocks[i]?.digits);
}

function Blocks({ view, from }: { view: CodeView; from: number }) {
  return (
    <ol className="space-y-1">
      {view.blocks.map((b, i) => {
        const differs = from !== -1 && i >= from;
        return (
          <li key={ta.drawer.levels[i]} className={`flex items-baseline gap-3 rounded px-2 py-1 ${differs ? 'bg-warn-tint' : ''}`}>
            <span className="w-24 shrink-0 text-xs text-muted">{ta.drawer.levels[i]}</span>
            <span className="shrink-0 rounded bg-surface px-1.5 font-mono text-xs">{b.digits}</span>
            <span className="min-w-0 truncate text-sm" title={b.name ?? undefined}>{b.name ?? '—'}</span>
          </li>
        );
      })}
    </ol>
  );
}

type Props = { title: string; view: CodeView | null; other: CodeView | null; empty: string };

/** A code split into guruh / sinf / pozitsiya / subpozitsiya / brend; levels from the first difference are tinted. */
export function CodeCompare({ title, view, other, empty }: Props) {
  const from = divergence(view, other);
  return (
    <section className="rounded-ctl border border-line p-3">
      <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">{title}</h3>
      {view ? <Blocks view={view} from={from} /> : <p className="text-sm text-muted">{empty}</p>}
      {view && !view.live ? <p className="mt-2 text-xs font-medium text-danger">{ta.drawer.archived}</p> : null}
    </section>
  );
}
