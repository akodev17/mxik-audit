'use client';

import { useEffect, useState } from 'react';
import { ta } from '@/lib/i18n-app';
import { Button } from '@/ui/button';

const STEPS = [ta.hint.one, ta.hint.two, ta.hint.three] as const;

type Props = { storageKey: string; onDone: () => void };

/** Three one-time tips for a demo visitor; dismissed once, never shown again for that session. */
export function OnboardingHint({ storageKey, onDone }: Props) {
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
    <div role="dialog" aria-label="Maslahat" className="no-print fixed bottom-6 left-1/2 z-40 w-[min(520px,calc(100vw-2rem))] -translate-x-1/2 rounded-ctl bg-fg p-4 text-white shadow-pop">
      <p className="text-xs font-bold uppercase tracking-wide text-[#9db8ff]">{ta.hint.step(step + 1, STEPS.length)}</p>
      <p className="mt-1 text-[15px]">{STEPS[step]}</p>
      <div className="mt-3 flex items-center justify-end gap-2">
        <button type="button" onClick={close} className="px-2 text-sm text-[#b8c3cf] hover:text-white">{ta.hint.skip}</button>
        <Button size="sm" variant="primary" onClick={() => (last ? close() : setStep(step + 1))}>{last ? ta.hint.done : ta.hint.next}</Button>
      </div>
    </div>
  );
}
