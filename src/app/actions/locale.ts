'use server';

import { cookies } from 'next/headers';
import { db } from '@/lib/db';
import { LOCALE_COOKIE, parseLocale } from '@/lib/locale';
import { currentUser } from '@/lib/session';

/** Switches the interface language: cookie for this browser, and the user's saved choice when signed in. */
export async function setLocale(value: unknown): Promise<void> {
  const locale = parseLocale(value);
  (await cookies()).set(LOCALE_COOKIE, locale, { maxAge: 60 * 60 * 24 * 365, path: '/', sameSite: 'lax' });
  const user = await currentUser();
  if (user && !user.demo) await db.user.update({ where: { id: user.userId }, data: { locale } });
}
