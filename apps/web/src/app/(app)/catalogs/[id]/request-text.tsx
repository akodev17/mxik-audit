'use client';

import { useState } from 'react';
import { api } from '@/lib/api/browser';
import { isNetworkFailure } from '@/lib/api-failure';
import { useI18n } from '@/lib/locale-client';
import { Button, buttonClass } from '@/ui/button';
import { Dialog } from '@/ui/dialog';
import { IconCopy } from '@/ui/icons';
import { Spinner } from '@/ui/spinner';
import { Textarea } from '@/ui/textarea';

/**
 * A ready-to-copy new-code request in a dialog; sending it to tasnif.soliq.uz is always the user's
 * step. The draft is read when the dialog opens. Viewers get the same draft, read-only.
 */
export function RequestText({ findingId, readOnly }: { findingId: string; readOnly: boolean }) {
  const { ta, locale } = useI18n();
  const u = ta.wsUi.drawer;
  const [open, setOpen] = useState(false);
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

  const show = (): void => {
    setOpen(true);
    setCopied(null);
    if (text === null && !busy) void load();
  };

  return (
    <>
      <Button size="sm" variant="secondary" onClick={show}>{u.requestOpen}</Button>
      <Dialog
        open={open} onClose={() => setOpen(false)} title={u.requestTitle} description={u.requestDescription} size="md"
        footer={(
          <>
            <a href="https://tasnif.soliq.uz" target="_blank" rel="noopener noreferrer" className={buttonClass('ghost', 'md', 'mr-auto text-brand-ink')}>tasnif.soliq.uz</a>
            <Button variant="secondary" onClick={() => setOpen(false)}>{u.close}</Button>
            <Button variant="primary" disabled={text === null} onClick={() => { if (text !== null) void copy(text); }}>
              <IconCopy size={16} />{copied === 'yes' ? ta.drawer.copied : ta.drawer.copy}
            </Button>
          </>
        )}
      >
        <div className="space-y-2">
          {busy ? <Spinner label={ta.wsX.drawer.loading} /> : null}
          {error ? (
            <div role="alert" className="flex flex-wrap items-center gap-3 text-small text-danger-ink">
              {error}
              <Button size="sm" onClick={() => { void load(); }}>{ta.wsX.drawer.retry}</Button>
            </div>
          ) : null}
          {text !== null ? <Textarea value={text} onChange={(e) => setText(e.target.value)} readOnly={readOnly} rows={10} aria-label={ta.drawer.request} /> : null}
          <p className="text-micro text-muted">{readOnly ? ta.wsX.drawer.requestReadOnly : ta.drawer.requestHint}</p>
          {/* The draft is written for the soliq portal in Uzbek; a Russian reader is told so. */}
          {locale === 'ru' ? <p className="text-micro text-muted">{ta.wsX.drawer.requestLanguage}</p> : null}
          <p aria-live="polite" className="text-micro text-danger-ink">{copied === 'no' ? ta.shellX.ui.copyFailed : ''}</p>
        </div>
      </Dialog>
    </>
  );
}
