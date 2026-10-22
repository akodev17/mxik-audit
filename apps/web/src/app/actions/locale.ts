'use server';

import { cookies } from 'next/headers';
import { chooseLocale } from '@tasnivo/domain/account-settings';
import { LOCALE_COOKIE } from '@/lib/locale';
import { currentUser } from '@/lib/session';

/** Switches the interface language: cookie for this browser, and the user's saved choice when signed in. */
export async function setLocale(value: unknown): Promise<void> {
  const user = await currentUser();
  const locale = await chooseLocale(value, user);
  (await cookies()).set(LOCALE_COOKIE, locale, { maxAge: 60 * 60 * 24 * 365, path: '/', sameSite: 'lax' });
}
