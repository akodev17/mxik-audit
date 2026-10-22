'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { appDict, type AppDict } from '@tasnivo/i18n/i18n-app';
import { DEFAULT_LOCALE, dict, type Dict, type Locale } from '@tasnivo/i18n/i18n';

type Value = { locale: Locale; t: Dict; ta: AppDict };

const Ctx = createContext<Value>({ locale: DEFAULT_LOCALE, t: dict(DEFAULT_LOCALE), ta: appDict(DEFAULT_LOCALE) });

/** Hands the request's language to client components. */
export function LocaleProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  const value = useMemo<Value>(() => ({ locale, t: dict(locale), ta: appDict(locale) }), [locale]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): Value {
  return useContext(Ctx);
}

/** BCP 47 tag for number and date formatting. */
export const useFormatTag = (): string => (useContext(Ctx).locale === 'ru' ? 'ru-RU' : 'uz-UZ');

/** Same tag without the hook, for callbacks. */
export const formatTagOf = (locale: Locale): string => (locale === 'ru' ? 'ru-RU' : 'uz-UZ');
