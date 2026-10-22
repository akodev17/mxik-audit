'use client';

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Theme } from '../theme';

type Value = { theme: Theme; applyTheme: (theme: Theme) => void };

const Ctx = createContext<Value | null>(null);

/** The .app element with its data-theme; the user menu changes it at once, the cookie keeps it. */
export function ThemeRoot({ initial, className, children }: { initial: Theme; className: string; children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(initial);
  // A server render with a newer cookie (refresh, another tab) wins.
  useEffect(() => setTheme(initial), [initial]);
  const value = useMemo<Value>(() => ({ theme, applyTheme: setTheme }), [theme]);
  return (
    <Ctx.Provider value={value}>
      <div className={className} data-theme={theme}>{children}</div>
    </Ctx.Provider>
  );
}

/** Null outside ThemeRoot (pages that render .app themselves have no switch). */
export function useTheme(): Value | null {
  return useContext(Ctx);
}
