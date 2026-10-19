'use client';

import { useI18n } from '@/lib/locale-client';
import { useEffect, useState } from 'react';
import { Button } from '@/ui/button';

type Props = { storageKey: string; onDone: () => void };

/** Three one-time tips for a demo visitor; dismissed once, never shown again for that session. */
export function OnboardingHint({ storageKey, onDone }: Props) {
  const { ta } = useI18n();
  const STEPS = [ta.hint.one, ta.hint.two, ta.hint.three];
  const [step, setStep] = useState<number | null>(null);

  useEffect(() => {
    let seen = false;
    try { seen = localStorage.getItem(storageKey) === '1'; } catch { /* storage blocked: show once per load */ }
    if (seen) onDone(); else setStep(0);
  }, [storageKey, onDone]);

  function close(): void {
    try { localStorage.setItem(storageKey, '1'); } catch { /* storage blocked */ }
    setStep(null);
    onDone();
  }

  if (step === null) return null;
  const last = step === STEPS.length - 1;
  return (
    <div role="dialog" aria-label={ta.shell.tip} className="no-print fixed bottom-6 left-1/2 z-modal w-[min(520px,calc(100vw-2rem))] -translate-x-1/2 rounded-lg bg-fg p-4 text-inverse shadow-pop">
      <p className="text-micro font-semibold text-inverse opacity-80">{ta.hint.step(step + 1, STEPS.length)}</p>
      <p className="mt-1 text-body">{STEPS[step]}</p>
      <div className="mt-3 flex items-center justify-end gap-2">
        <button type="button" onClick={close} className="rounded-sm px-2 text-small text-inverse opacity-80 hover:opacity-100">{ta.hint.skip}</button>
        <Button size="sm" variant="primary" onClick={() => (last ? close() : setStep(step + 1))}>{last ? ta.hint.done : ta.hint.next}</Button>
      </div>
    </div>
  );
}
