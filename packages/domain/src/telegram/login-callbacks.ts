// The two Telegram Login Widget callbacks as functions answering where the browser goes, shared by
// the web app's route handlers and the API.
//
// Sign-in page: signs in the user who bound this Telegram account in Settings → Security. A
// Telegram id that is only a notification chat of some org is refused. A Telegram id never seen
// anywhere opens a trial account, as before bindings existed (deliberate self-serve signup), and
// that account is bound to it.
//
// Settings → Security: binds the signed-in user's own Telegram account. The one-time state in the
// path must match the one this browser's session got from startTelegramBind, so a link from
// someone else cannot bind their Telegram here. Sign-in works the same way since S1
// (startTelegramLogin), so nobody can sign a victim's browser into the attacker's account.
import { randomBytes } from 'node:crypto';
import { db } from '@tasnivo/db';
import { isDemoOrg } from '../demo.js';
import { hit, RULES } from '../security/rate-limit.js';
import { claimOnce } from '../security/replay.js';
import { telegramEmail } from '../security/reserved-email.js';
import { safeEqualText } from '../security/safe-equal.js';
import { openSession, type SignInSession } from '../security/sign-in.js';
import { createAccount } from '../signup.js';
import { telegramConfig } from './config.js';
import { bindTelegram, loginTarget } from './identity.js';
import { checkTelegramLogin, verifyTelegramLogin, type TelegramLoginData } from './login.js';

type Who = { id: string; orgId: string; email: string };

/** How long the state from startTelegramBind is accepted. */
export const BIND_STATE_TTL_MS = 10 * 60_000;

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

/**
 * Starts Telegram sign-in on the sign-in or sign-up page: a one-time state in this browser's session
 * that the widget's callback path must bring back, as binding does. Null when Telegram sign-in is off.
 */
export async function startTelegramLogin(session: SignInSession): Promise<string | null> {
  const config = telegramConfig();
  if (!config.token || !config.username) return null;
  const state = randomBytes(18).toString('base64url');
  session.tgLogin = state;
  session.tgLoginAt = Date.now();
  await session.save();
  return state;
}

/**
 * The sign-in page's callback: the path to send the browser to. `state` must be the one this browser
 * got from startTelegramLogin (spent whatever the outcome), so a signed answer captured from someone
 * else's widget cannot sign this browser in (login CSRF). `ip` is the client address for the signup limit.
 */
export async function telegramSignIn(session: SignInSession, state: string, data: TelegramLoginData, req: { ip: string; userAgent: string | null }): Promise<string> {
  const config = telegramConfig();
  if (!config.token || !config.username) return '/sign-in';
  const expected = session.tgLogin;
  const fresh = session.tgLoginAt !== undefined && Date.now() - session.tgLoginAt <= BIND_STATE_TTL_MS;
  session.tgLogin = undefined;
  session.tgLoginAt = undefined;
  await session.save();
  if (!expected || !fresh || !safeEqualText(expected, state)) return '/sign-in?error=telegram_state';
  // A bad signature is not "expired" (Q14): the page says the data could not be checked.
  const check = checkTelegramLogin(data, config.token);
  if (check !== 'ok') return `/sign-in?error=telegram_${check}`;
  if (!(await claimOnce('tg_replay', data['hash'] ?? ''))) return '/sign-in?error=telegram_expired';
  const telegramId = data['id'] ?? '';

  const target = await loginTarget(telegramId);
  if (target.kind === 'unbound') return '/sign-in?error=telegram_unbound';
  let user: Who | null = target.kind === 'user' ? target.user : null;
  if (target.kind === 'new') {
    if (!(await hit(RULES.signupIp, req.ip)).allowed) return '/sign-in?error=telegram_limit';
    user = await openTelegramAccount(telegramId, data);
  }
  if (!user) return '/sign-in?error=telegram';

  const next = await openSession(session, user, { via: 'telegram', landing: '/dashboard' }, req.userAgent);
  return next ?? '/sign-in?error=telegram';
}

/**
 * The Settings callback: the path to send the browser to. `user` is the signed-in user, or null
 * (then the browser goes to sign in). The state is spent whatever the outcome.
 */
export async function telegramBindCallback(
  session: SignInSession, user: { userId: string; orgId: string } | null, state: string, data: TelegramLoginData,
): Promise<string> {
  const back = (result: string): string => `/settings?tg=${result}#telegram-sign-in`;
  if (!user) return '/sign-in';
  const config = telegramConfig();
  if (!config.token || await isDemoOrg(user.orgId)) return back('error');

  const expected = session.tgBind;
  const fresh = session.tgBindAt !== undefined && Date.now() - session.tgBindAt <= BIND_STATE_TTL_MS;
  session.tgBind = undefined;
  session.tgBindAt = undefined;
  await session.save();
  if (!expected || !fresh || !safeEqualText(expected, state)) return back('error');

  if (!verifyTelegramLogin(data, config.token) || !(await claimOnce('tg_replay', data['hash'] ?? ''))) return back('error');
  return back(await bindTelegram(user, data['id'] ?? ''));
}
