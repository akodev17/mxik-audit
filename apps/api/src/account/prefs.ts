// The browser preference cookies, with the web app's names and options (apps/web/src/ui/theme.ts,
// apps/web/src/ui/shell/prefs.ts, the locale actions). test/unit/prefs.test.ts fails when they drift.
import type { Response } from 'express';
import { serialize } from 'cookie';
import { LOCALE_COOKIE } from '@tasnivo/i18n/locale';
import { setCookie } from '../auth-core/session.service';

export const THEME_COOKIE = 'mxik_theme';
export const SIDEBAR_COOKIE = 'mxik_sidebar';
/** One year, the whole site, sent on top-level navigations: as the web app sets them. */
export const PREF_COOKIE_OPTIONS = { maxAge: 60 * 60 * 24 * 365, path: '/', sameSite: 'lax' as const };

export function setPrefCookie(res: Response, name: string, value: string): void {
  setCookie(res, name, serialize(name, value, PREF_COOKIE_OPTIONS));
}

/** The interface language cookie (mxik_locale). */
export function setLocaleCookie(res: Response, locale: string): void {
  setPrefCookie(res, LOCALE_COOKIE, locale);
}
