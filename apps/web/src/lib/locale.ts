// The interface language of the current request, read from a cookie that the
// language switch sets (and that sign-in restores from the user's saved choice).
import { cookies } from 'next/headers';
import { cache } from 'react';
import { appDict } from '@tasnivo/i18n/i18n-app';
import { dict, type Locale } from '@tasnivo/i18n/i18n';
import { LOCALE_COOKIE, parseLocale, type I18n } from '@tasnivo/i18n/locale';

export { formatTag, i18nFor, LOCALE_COOKIE, parseLocale, type I18n } from '@tasnivo/i18n/locale';

export async function getLocale(): Promise<Locale> {
  return parseLocale((await cookies()).get(LOCALE_COOKIE)?.value);
}

/** Both dictionaries for the request's language; once per render. */
export const getI18n = cache(async (): Promise<I18n> => {
  const locale = await getLocale();
  return { locale, t: dict(locale), ta: appDict(locale) };
});
