// Callback of the Telegram Login Widget in Settings → Security: binds the signed-in user's own
// Telegram account for signing in. The one-time state in the path must match the one this
// browser's session got from startTelegramBind, so a link from someone else cannot bind their Telegram here.
import type { NextRequest } from 'next/server';
import { isDemoOrg } from '@/lib/demo';
import { redirectTo } from '@/lib/security/redirect';
import { claimOnce } from '@/lib/security/replay';
import { safeEqualText } from '@/lib/security/safe-equal';
import { currentUser, getSession } from '@/lib/session';
import { telegramConfig } from '@/lib/telegram/config';
import { bindTelegram } from '@/lib/telegram/identity';
import { verifyTelegramLogin } from '@/lib/telegram/login';

export const dynamic = 'force-dynamic';

const STATE_TTL_MS = 10 * 60_000;

export async function GET(request: NextRequest, { params }: { params: Promise<{ state: string }> }) {
  const back = (result: string) => redirectTo(`/settings?tg=${result}#telegram-sign-in`);
  const user = await currentUser();
  if (!user) return redirectTo('/sign-in');
  const config = telegramConfig();
  if (!config.token || await isDemoOrg(user.orgId)) return back('error');

  const { state } = await params;
  const session = await getSession();
  const expected = session.tgBind;
  const fresh = session.tgBindAt !== undefined && Date.now() - session.tgBindAt <= STATE_TTL_MS;
  session.tgBind = undefined;
  session.tgBindAt = undefined;
  await session.save();
  if (!expected || !fresh || !safeEqualText(expected, state)) return back('error');

  const data = Object.fromEntries(request.nextUrl.searchParams.entries());
  if (!verifyTelegramLogin(data, config.token) || !(await claimOnce('tg_replay', data['hash'] ?? ''))) return back('error');
  return back(await bindTelegram(user, data['id'] ?? ''));
}
