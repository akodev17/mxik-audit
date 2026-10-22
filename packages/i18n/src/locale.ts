// Locale helpers that need no request. The web app's src/lib/locale.ts adds the
// cookie-reading getLocale/getI18n on top of these.
import { appDict, type AppDict } from './i18n-app';
import { dict, parseLocale, type Dict, type Locale } from './i18n';

export const LOCALE_COOKIE = 'mxik_locale';

export { parseLocale };

export type I18n = { locale: Locale; t: Dict; ta: AppDict };

export function i18nFor(locale: Locale): I18n {
  return { locale, t: dict(locale), ta: appDict(locale) };
}

/** BCP 47 tag for number and date formatting. */
export const formatTag = (locale: Locale): string => (locale === 'ru' ? 'ru-RU' : 'uz-UZ');
