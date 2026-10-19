// Callback of the Telegram Login Widget on the sign-in page. Signs in the user who bound this
// Telegram account in Settings → Security. A Telegram id that is only a notification chat of some
// org is refused. A Telegram id never seen anywhere opens a trial account, as before bindings
// existed (deliberate self-serve signup), and that account is bound to it.
import { randomBytes } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { clientIp } from '@/lib/security/client-ip';
import { hit, RULES } from '@/lib/security/rate-limit';
import { redirectTo } from '@/lib/security/redirect';
import { telegramEmail } from '@/lib/security/reserved-email';
import { claimOnce } from '@/lib/security/replay';
import { openSession } from '@/lib/security/sign-in';
import { createAccount } from '@/lib/signup';
import { telegramConfig } from '@/lib/telegram/config';
import { loginTarget } from '@/lib/telegram/identity';
import { verifyTelegramLogin, type TelegramLoginData } from '@/lib/telegram/login';

export const dynamic = 'force-dynamic';

type Who = { id: string; orgId: string; email: string };

/** Opens a trial account for a Telegram id seen for the first time, bound to it, with its private chat linked for notifications. */
async function openTelegramAccount(telegramId: string, data: TelegramLoginData): Promise<Who | null> {
  const created = await createAccount({
    email: telegramEmail(telegramId), password: randomBytes(18).toString('base64url'), verified: true, telegramUserId: telegramId,
    firmName: [data['first_name'], data['last_name']].filter(Boolean).join(' ') || data['username'] || 'Telegram',
  });
  if (!created.ok) return null;
  const { userId, orgId, email } = created.account;
  await db.telegramLink.create({ data: { orgId, chatId: telegramId, username: data['username'] ?? null, linkedBy: userId } }).catch(() => undefined);
  return { id: userId, orgId, email };
}

export async function GET(request: NextRequest) {
  const config = telegramConfig();
  const back = (path: string) => redirectTo(path);
  if (!config.token || !config.username) return back('/sign-in');

  const data = Object.fromEntries(request.nextUrl.searchParams.entries());
  if (!verifyTelegramLogin(data, config.token)) return back('/sign-in?error=telegram_expired');
  if (!(await claimOnce('tg_replay', data['hash'] ?? ''))) return back('/sign-in?error=telegram_expired');
  const telegramId = data['id'] ?? '';

  const target = await loginTarget(telegramId);
  if (target.kind === 'unbound') return back('/sign-in?error=telegram_unbound');
  let user: Who | null = target.kind === 'user' ? target.user : null;
  if (target.kind === 'new') {
    if (!(await hit(RULES.signupIp, clientIp(request.headers))).allowed) return back('/sign-in?error=telegram_limit');
    user = await openTelegramAccount(telegramId, data);
  }
  if (!user) return back('/sign-in?error=telegram');

  const next = await openSession(user, { via: 'telegram', landing: '/dashboard' });
  return back(next ?? '/sign-in?error=telegram');
}
