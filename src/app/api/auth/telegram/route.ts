// Callback of the Telegram Login Widget: signs in the linked user, or opens a trial account.
import { randomBytes } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { createAccount } from '@/lib/signup';
import { getSession } from '@/lib/session';
import { telegramConfig } from '@/lib/telegram/config';
import { verifyTelegramLogin } from '@/lib/telegram/login';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const config = telegramConfig();
  const origin = new URL(request.url).origin;
  const back = (path: string) => NextResponse.redirect(`${origin}${path}`);
  if (!config.token || !config.username) return back('/sign-in');

  const data = Object.fromEntries(request.nextUrl.searchParams.entries());
  if (!verifyTelegramLogin(data, config.token)) return back('/sign-in?error=telegram');
  const telegramId = data['id'] ?? '';

  // A private chat's id is the user's id, so a linked chat identifies the account.
  const link = await db.telegramLink.findUnique({ where: { chatId: telegramId } });
  let user = link
    ? (link.linkedBy ? await db.user.findUnique({ where: { id: link.linkedBy } }) : null)
      ?? await db.user.findFirst({ where: { orgId: link.orgId, role: 'admin' }, orderBy: { createdAt: 'asc' } })
    : null;

  if (!user) {
    const created = await createAccount({
      email: `tg-${telegramId}@telegram.invalid`, password: randomBytes(18).toString('base64url'),
      firmName: [data['first_name'], data['last_name']].filter(Boolean).join(' ') || data['username'] || 'Telegram', verified: true,
    });
    if (!created.ok) return back('/sign-in?error=telegram');
    await db.telegramLink.create({ data: { orgId: created.account.orgId, chatId: telegramId, username: data['username'] ?? null, linkedBy: created.account.userId } }).catch(() => undefined);
    user = await db.user.findUnique({ where: { id: created.account.userId } });
  }
  if (!user) return back('/sign-in?error=telegram');

  const session = await getSession();
  session.userId = user.id;
  session.orgId = user.orgId;
  session.email = user.email;
  session.demo = false;
  session.clientId = undefined;
  await session.save();
  await db.auditEvent.create({ data: { orgId: user.orgId, actorId: user.id, action: 'user.signed_in', payload: { via: 'telegram' } } });
  return back('/dashboard');
}
