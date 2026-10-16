import type { ReactNode } from 'react';
import { LocaleProvider } from '@/lib/locale-client';
import { getLocale } from '@/lib/locale';

/** Wraps a page tree so client components read the request's language. Reading the cookie makes the tree dynamic. */
export async function LocaleScope({ children }: { children: ReactNode }) {
  return <LocaleProvider locale={await getLocale()}>{children}</LocaleProvider>;
}
