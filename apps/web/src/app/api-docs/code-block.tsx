'use client';

import { useState } from 'react';
import { useI18n } from '@/lib/locale-client';
import { Button } from '@/ui/button';
import { cx } from '@/ui/cx';
import { IconCheck, IconCopy } from '@/ui/icons';

type Copy = 'idle' | 'done' | 'failed';

/** A code sample that scrolls sideways by default (keyboard-scrollable), with a wrap toggle and a copy button. */
export function CodeBlock({ code, label }: { code: string; label: string }) {
  const { ta } = useI18n();
  const d = ta.setX.docs;
  const [wrap, setWrap] = useState(false);
  const [copy, setCopy] = useState<Copy>('idle');

  const copyCode = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(code);
      setCopy('done');
    } catch {
      setCopy('failed');
    }
    setTimeout(() => setCopy('idle'), 2000);
  };

  return (
    <figure className="relative min-w-0 overflow-hidden rounded-lg border border-line bg-sunken">
      <figcaption className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-surface px-3 py-1">
        <span className="font-mono text-micro font-medium text-muted">{label}</span>
        <span className="flex items-center gap-1">
          <Button size="compact" variant="ghost" aria-pressed={wrap} onClick={() => setWrap((w) => !w)}>{d.wrap}</Button>
          <Button size="compact" variant="ghost" onClick={() => void copyCode()}>
            {copy === 'done' ? <IconCheck size={14} className="text-good-ink" /> : <IconCopy size={14} />}
            {copy === 'done' ? d.copied : d.copy}
          </Button>
          <span role="status" className={copy === 'failed' ? 'text-micro text-danger-ink' : 'sr-only'}>{copy === 'done' ? d.copied : copy === 'failed' ? d.copyFailed : ''}</span>
        </span>
      </figcaption>
      <pre
        tabIndex={0} aria-label={label}
        className={cx('overflow-x-auto p-4 font-mono text-mono leading-relaxed text-fg', wrap ? 'whitespace-pre-wrap break-words' : 'whitespace-pre')}
      >
        <code>{code}</code>
      </pre>
    </figure>
  );
}
