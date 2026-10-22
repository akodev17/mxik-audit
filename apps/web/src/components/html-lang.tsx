'use client';

import { useEffect } from 'react';

/** Sets <html lang> for pages whose language differs from the root layout's; restores it on leave. */
export function HtmlLang({ lang }: { lang: string }) {
  useEffect(() => {
    const root = document.documentElement;
    const before = root.lang;
    root.lang = lang;
    return () => { root.lang = before; };
  }, [lang]);
  return null;
}
