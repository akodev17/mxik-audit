import { ta } from '@/lib/i18n-app';
import { t } from '@/lib/i18n';
import { CodeChip } from '@/ui/code-chip';

type Props = {
  code: string | null;
  name: string | null;
  state?: 'ok' | 'archived' | 'unknown' | null;
  empty: string;
  compact: boolean;
};

/** Code chip with a one-line, truncated classifier name. */
export function CodeCell({ code, name, state, empty, compact }: Props) {
  if (!code) return <span className="text-sm text-muted">{empty}</span>;
  const flag = state === 'archived' ? t.codeArchived : state === 'unknown' ? ta.drawer.unknown : null;
  return (
    <span className={compact ? 'flex min-w-0 items-center gap-2' : 'flex min-w-0 flex-col items-start gap-0.5'}>
      <CodeChip code={code} className="shrink-0" />
      <span className="min-w-0 max-w-full truncate text-sm" title={name ?? undefined}>
        {flag ? <span className="font-medium text-danger">{flag}</span> : <span className="text-muted">{name}</span>}
      </span>
    </span>
  );
}
