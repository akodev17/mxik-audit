'use client';

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';

type Toast = { id: number; message: string; action?: { label: string; run: () => void }; tone: 'ok' | 'error' };
type Push = (message: string, opts?: { action?: Toast['action']; tone?: Toast['tone'] }) => void;

const Ctx = createContext<Push>(() => undefined);

export const useToast = (): Push => useContext(Ctx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const next = useRef(1);

  const dismiss = useCallback((id: number) => setItems((cur) => cur.filter((x) => x.id !== id)), []);
  const push = useCallback<Push>((message, opts) => {
    const id = next.current++;
    setItems((cur) => [...cur.slice(-2), { id, message, action: opts?.action, tone: opts?.tone ?? 'ok' }]);
    setTimeout(() => dismiss(id), 6000);
  }, [dismiss]);

  return (
    <Ctx.Provider value={push}>
      {children}
      <div aria-live="polite" className="no-print pointer-events-none fixed bottom-4 left-4 z-50 flex flex-col items-start gap-2">
        {items.map((x) => (
          <div key={x.id} className="pointer-events-auto flex items-center gap-4 rounded-ctl bg-fg px-4 py-2.5 text-sm text-white shadow-pop">
            <span className={x.tone === 'error' ? 'text-[#ffb4a8]' : ''}>{x.message}</span>
            {x.action ? (
              <button type="button" onClick={() => { x.action?.run(); dismiss(x.id); }} className="font-medium text-[#9db8ff] hover:text-white">
                {x.action.label}
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
