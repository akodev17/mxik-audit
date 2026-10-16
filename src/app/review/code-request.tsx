'use client';

import { useState, useTransition } from 'react';
import { newCodeRequest } from '@/app/actions/review';
import { t } from '@/lib/i18n';

/** Shows a ready-to-copy request text; submitting it is always the user's step. */
export function CodeRequest({ findingId }: { findingId: string }) {
  const [text, setText] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, start] = useTransition();

  if (text === null) {
    return (
      <button
        type="button" disabled={busy}
        onClick={() => start(async () => setText(await newCodeRequest(findingId)))}
        className="whitespace-nowrap text-xs text-ink-soft underline disabled:opacity-50"
      >
        {t.codeRequestButton}
      </button>
    );
  }
  return (
    <div className="mt-1 w-72 border border-ink bg-paper p-2" onClick={(e) => e.stopPropagation()}>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={9} className="w-full border border-rule p-1 text-xs" />
      <div className="mt-1 flex flex-wrap items-center gap-3 text-xs">
        <button
          type="button"
          onClick={() => { void navigator.clipboard.writeText(text).then(() => setCopied(true)); }}
          className="bg-ink px-2 py-1 text-paper"
        >
          {copied ? t.codeRequestCopied : t.codeRequestCopy}
        </button>
        <a href="https://tasnif.soliq.uz" target="_blank" rel="noopener noreferrer" className="underline">tasnif.soliq.uz</a>
        <button type="button" onClick={() => setText(null)} className="text-ink-soft underline">{t.back}</button>
      </div>
      <p className="mt-1 text-xs text-ink-faint">{t.codeRequestHint}</p>
    </div>
  );
}
