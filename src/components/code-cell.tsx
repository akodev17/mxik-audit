// A code with what it means: classifier name and short path (full path on
// hover). No hooks, so server pages and client lists share it.
import type { CodeInfo } from '@/lib/code-details';
import { t } from '@/lib/i18n';

type Props = {
  code: string | null;
  info: CodeInfo | null;
  /** Shown when there is no code at all. */
  empty?: string;
  /** Hide the name and path, e.g. in a dense alternatives list. */
  compact?: boolean;
};

export function CodeCell({ code, info, empty, compact }: Props) {
  if (!code) return <span className="text-xs text-ink-faint">{empty ?? '—'}</span>;
  return (
    <span className="block">
      <span className="code block text-xs">{code}</span>
      {info ? (
        <>
          {!compact ? <span className="line-clamp-2 block text-xs text-ink-soft" title={info.name}>{info.name}</span> : null}
          {!compact && info.shortPath ? (
            <span className="block text-xs text-ink-faint" title={info.fullPath}>{info.shortPath}</span>
          ) : null}
          {!info.live ? <span className="mt-0.5 block text-xs text-risk">{t.codeArchived}</span> : null}
        </>
      ) : (
        <span className="block text-xs text-risk">{t.codeUnknown}</span>
      )}
    </span>
  );
}
