// The interface language of the current request, read from a cookie that the
// language switch sets (and that sign-in restores from the user's saved choice).
import { cookies } from 'next/headers';
import { cache } from 'react';
import { appDict, type AppDict } from './i18n-app';
import { dict, parseLocale, type Dict, type Locale } from './i18n';

export const LOCALE_COOKIE = 'mxik_locale';

export { parseLocale };

export async function getLocale(): Promise<Locale> {
  return parseLocale((await cookies()).get(LOCALE_COOKIE)?.value);
}

export type I18n = { locale: Locale; t: Dict; ta: AppDict };

/** Both dictionaries for the request's language; once per render. */
export const getI18n = cache(async (): Promise<I18n> => {
  const locale = await getLocale();
  return { locale, t: dict(locale), ta: appDict(locale) };
});

export function i18nFor(locale: Locale): I18n {
  return { locale, t: dict(locale), ta: appDict(locale) };
}

/** BCP 47 tag for number and date formatting. */
export const formatTag = (locale: Locale): string => (locale === 'ru' ? 'ru-RU' : 'uz-UZ');
