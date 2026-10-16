'use client';

import { useI18n } from '@/lib/locale-client';
import { useState, useTransition } from 'react';
import { newCodeRequest } from '@/app/actions/review';
import { Button } from '@/ui/button';

/** A ready-to-copy new-code request; sending it to tasnif.soliq.uz is always the user's step. */
export function RequestText({ findingId }: { findingId: string }) {
  const { ta } = useI18n();
  const [text, setText] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, start] = useTransition();

  if (text === null) {
    return (
      <Button variant="secondary" disabled={busy} onClick={() => start(async () => setText(await newCodeRequest(findingId)))}>
        {ta.drawer.request}
      </Button>
    );
  }
  return (
    <div className="rounded-ctl border border-line p-3">
      <textarea
        value={text} onChange={(e) => setText(e.target.value)} rows={9} aria-label={ta.drawer.request}
        className="w-full rounded-ctl border border-line-strong p-2 text-sm focus:border-brand focus:outline-none"
      />
      <div className="mt-2 flex items-center gap-3">
        <Button size="sm" variant="primary" onClick={() => { void navigator.clipboard.writeText(text).then(() => setCopied(true)); }}>
          {copied ? ta.drawer.copied : ta.drawer.copy}
        </Button>
        <a href="https://tasnif.soliq.uz" target="_blank" rel="noopener noreferrer" className="text-sm text-brand hover:underline">tasnif.soliq.uz</a>
      </div>
      <p className="mt-2 text-xs text-muted">{ta.drawer.requestHint}</p>
    </div>
  );
}
