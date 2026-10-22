// Telegram sign-in identity. A person binds their own Telegram account in Settings → Security
// while signed in; only that binding signs anyone in. Notification chats (telegram_link) never do.
import { db } from '@tasnivo/db';
import { isReservedEmail, telegramEmail } from '../security/reserved-email.js';

type Who = { id: string; orgId: string; email: string };
type Actor = { userId: string; orgId: string };

export type LoginTarget = { kind: 'user'; user: Who } | { kind: 'unbound' } | { kind: 'new' };

const WHO = { id: true, orgId: true, email: true } as const;

/** An account opened with Telegram before bindings existed: its placeholder address plus the Telegram "account.created" event. Bound on first use. */
async function legacyAccount(telegramId: string): Promise<Who | null> {
  const user = await db.user.findUnique({ where: { email: telegramEmail(telegramId) }, select: { ...WHO, telegramUserId: true } });
  if (!user || user.telegramUserId) return null;
  const created = await db.auditEvent.findFirst({
    where: { orgId: user.orgId, actorId: user.id, action: 'account.created', payload: { path: ['via'], equals: 'telegram' } }, select: { id: true },
  });
  if (!created) return null;
  const bound = await db.user.updateMany({ where: { id: user.id, telegramUserId: null }, data: { telegramUserId: telegramId } }).catch(() => ({ count: 0 }));
  return bound.count === 1 ? { id: user.id, orgId: user.orgId, email: user.email } : null;
}

/**
 * Who a verified Telegram id signs in as. 'unbound': the id is a notification chat of some org
 * but nobody bound it, so it is refused. 'new': never seen, so a trial account may be opened.
 */
export async function loginTarget(telegramId: string): Promise<LoginTarget> {
  const bound = await db.user.findUnique({ where: { telegramUserId: telegramId }, select: WHO });
  if (bound) return { kind: 'user', user: bound };
  const legacy = await legacyAccount(telegramId);
  if (legacy) return { kind: 'user', user: legacy };
  const chat = await db.telegramLink.findUnique({ where: { chatId: telegramId }, select: { id: true } });
  return chat ? { kind: 'unbound' } : { kind: 'new' };
}

export type BindResult = 'bound' | 'taken';

export async function bindTelegram(actor: Actor, telegramId: string): Promise<BindResult> {
  const holder = await db.user.findUnique({ where: { telegramUserId: telegramId }, select: { id: true } });
  if (holder && holder.id !== actor.userId) return 'taken';
  const saved = await db.user.update({ where: { id: actor.userId }, data: { telegramUserId: telegramId } }).then(() => true, () => false);
  if (!saved) return 'taken';
  await db.auditEvent.create({ data: { orgId: actor.orgId, actorId: actor.userId, action: 'security.telegram_bound', targetId: actor.userId, payload: {} } });
  return 'bound';
}

export type TelegramBinding = { bound: boolean; canUnbind: boolean };

/** An account opened with Telegram has no usable password or address, so its binding stays. */
export async function telegramBinding(userId: string): Promise<TelegramBinding> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { telegramUserId: true, email: true } });
  const bound = Boolean(user?.telegramUserId);
  return { bound, canUnbind: bound && !isReservedEmail(user?.email ?? '') };
}

export async function unbindTelegram(actor: Actor): Promise<boolean> {
  if (!(await telegramBinding(actor.userId)).canUnbind) return false;
  const done = await db.user.updateMany({ where: { id: actor.userId, telegramUserId: { not: null } }, data: { telegramUserId: null } });
  if (done.count === 0) return false;
  await db.auditEvent.create({ data: { orgId: actor.orgId, actorId: actor.userId, action: 'security.telegram_unbound', targetId: actor.userId, payload: {} } });
  return true;
}
