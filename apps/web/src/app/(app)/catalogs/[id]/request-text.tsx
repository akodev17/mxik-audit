'use client';

import { useState } from 'react';
import { api } from '@/lib/api/browser';
import { isNetworkFailure } from '@/lib/api-failure';
import { useI18n } from '@/lib/locale-client';
import { Button } from '@/ui/button';
import { Textarea } from '@/ui/textarea';

/**
 * A ready-to-copy new-code request; sending it to tasnif.soliq.uz is always
 * the user's step. Viewers get the same draft, read-only.
 */
export function RequestText({ findingId, readOnly }: { findingId: string; readOnly: boolean }) {
  const { ta, locale } = useI18n();
  const [text, setText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<'yes' | 'no' | null>(null);

  async function load(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const draft = await api.workspace.newCodeRequest({ findingId });
      if (draft === null) setError(ta.wsX.drawer.failed); else setText(draft);
    } catch (error) {
      setError(isNetworkFailure(error) ? ta.wsX.toast.network : ta.wsX.drawer.failed);
    } finally {
      setBusy(false);
    }
  }

  async function copy(value: string): Promise<void> {
    try { await navigator.clipboard.writeText(value); setCopied('yes'); } catch { setCopied('no'); }
  }

  if (text === null) {
    return (
      <div>
        <Button variant="secondary" loading={busy} onClick={() => { void load(); }}>{ta.drawer.request}</Button>
        {error ? <p role="alert" className="mt-1 text-small text-danger-ink">{error}</p> : null}
      </div>
    );
  }
  return (
    <div className="rounded-ctl border border-line p-3">
      <Textarea value={text} onChange={(e) => setText(e.target.value)} readOnly={readOnly} rows={9} aria-label={ta.drawer.request} />
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <Button size="sm" variant="secondary" onClick={() => { void copy(text); }}>{copied === 'yes' ? ta.drawer.copied : ta.drawer.copy}</Button>
        <a href="https://tasnif.soliq.uz" target="_blank" rel="noopener noreferrer" className="text-small text-brand-ink hover:underline">tasnif.soliq.uz</a>
        <span aria-live="polite" className="text-micro text-muted">{copied === 'no' ? ta.shellX.ui.copyFailed : ''}</span>
      </div>
      <p className="mt-2 text-micro text-muted">{readOnly ? ta.wsX.drawer.requestReadOnly : ta.drawer.requestHint}</p>
      {/* The draft is written for the soliq portal in Uzbek; a Russian reader is told so. */}
      {locale === 'ru' ? <p className="mt-1 text-micro text-muted">{ta.wsX.drawer.requestLanguage}</p> : null}
    </div>
  );
}
