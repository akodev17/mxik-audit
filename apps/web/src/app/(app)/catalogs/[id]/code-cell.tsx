'use client';

import { useI18n } from '@/lib/locale-client';
import type { CodeState } from '@tasnivo/domain/workspace-rows';
import { CodeChip } from '@/ui/code-chip';

type Props = {
  code: string | null;
  name: string | null;
  state?: CodeState | null;
  empty: string;
  compact: boolean;
};

/**
 * Code chip with a one-line classifier name, or the reason the code has none.
 * The name shortens with an ellipsis inside the cell; in compact rows only a
 * missing or retired code keeps its line, the name moves to the title.
 */
export function CodeCell({ code, name, state, empty, compact }: Props) {
  const { ta } = useI18n();
  if (!code) return <span className="block truncate text-small text-muted">{empty}</span>;
  const flag = state === 'archived' ? ta.wsX.codeState.archived : state === 'unknown' ? ta.wsX.codeState.unknown : null;
  const title = flag ?? name ?? undefined;
  if (compact) {
    return (
      <span className="flex min-w-0 items-center gap-2" title={title}>
        <CodeChip code={code} className="shrink-0" />
        {flag ? <span className="min-w-0 truncate text-micro font-medium text-danger-ink">{flag}</span> : null}
      </span>
    );
  }
  return (
    <span className="flex min-w-0 flex-col gap-0.5">
      <CodeChip code={code} className="self-start" />
      <span className="block min-w-0 truncate text-small" title={title}>
        {flag ? <span className="font-medium text-danger-ink">{flag}</span> : <span className="text-muted">{name}</span>}
      </span>
    </span>
  );
}
