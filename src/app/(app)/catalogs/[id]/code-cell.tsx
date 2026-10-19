'use client';

import { useI18n } from '@/lib/locale-client';
import type { CodeState } from '@/lib/workspace-rows';
import { CodeChip } from '@/ui/code-chip';

type Props = {
  code: string | null;
  name: string | null;
  state?: CodeState | null;
  empty: string;
  compact: boolean;
};

/** Code chip with a one-line classifier name, or the reason the code has none. */
export function CodeCell({ code, name, state, empty, compact }: Props) {
  const { ta } = useI18n();
  if (!code) return <span className="text-small text-muted">{empty}</span>;
  const flag = state === 'archived' ? ta.wsX.codeState.archived : state === 'unknown' ? ta.wsX.codeState.unknown : null;
  return (
    <span className={compact ? 'flex min-w-0 items-center gap-2' : 'flex min-w-0 flex-col items-start gap-0.5'}>
      <CodeChip code={code} className="shrink-0" />
      <span className="min-w-0 max-w-full truncate text-small" title={flag ?? name ?? undefined}>
        {flag ? <span className="font-medium text-danger-ink">{flag}</span> : <span className="text-muted">{name}</span>}
      </span>
    </span>
  );
}
