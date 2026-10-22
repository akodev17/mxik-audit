// The language an org's background messages (Telegram, stored notifications) use:
// its oldest admin's saved choice, else the default.
import { db } from '@tasnivo/db';
import { parseLocale, type Locale } from '@tasnivo/i18n/i18n';

export async function orgLocale(orgId: string): Promise<Locale> {
  const admin = await db.user.findFirst({
    where: { orgId, role: 'admin', locale: { not: null } }, orderBy: { createdAt: 'asc' }, select: { locale: true },
  });
  return parseLocale(admin?.locale);
}
