// Outbound Telegram messages: notifications to every chat linked to the org,
// and the audit summary to the chat that sent a file. No-ops when the bot is off.
import { Api } from 'grammy';
import { db } from '../db.js';
import { dict } from '../i18n.js';
import { orgLocale } from '../org-locale.js';
import { appLink, telegramConfig } from './config.js';
import { auditSummaryText } from './summary.js';

function api(): { api: Api; config: ReturnType<typeof telegramConfig> } | null {
  const config = telegramConfig();
  return config.token ? { api: new Api(config.token, { apiRoot: config.apiRoot }), config } : null;
}

/** Sends one notification to the org's linked chats, once. */
export async function deliverToTelegram(notificationId: string): Promise<void> {
  const bot = api();
  if (!bot) return;
  const n = await db.notification.findUnique({ where: { id: notificationId } });
  if (!n || n.telegramSentAt) return;
  const chats = await db.telegramLink.findMany({ where: { orgId: n.orgId }, select: { chatId: true } });
  if (chats.length === 0) return;
  const link = n.href ? appLink(bot.config, n.href) : null;
  const t = dict(await orgLocale(n.orgId));
  const text = [n.title, n.body, link ? `${t.notificationsOpen}: ${link}` : null].filter(Boolean).join('\n\n');
  for (const chat of chats) {
    await bot.api.sendMessage(chat.chatId, text, { link_preview_options: { is_disabled: true } });
  }
  await db.notification.update({ where: { id: n.id }, data: { telegramSentAt: new Date() } });
}

/** Replies to the chat a catalogue came from, once its audit has finished or failed. */
export async function sendAuditSummary(catalogId: string): Promise<void> {
  const bot = api();
  if (!bot) return;
  const catalog = await db.catalog.findUnique({ where: { id: catalogId }, select: { orgId: true, telegramChatId: true } });
  if (!catalog?.telegramChatId) return;
  const text = await auditSummaryText(catalogId, appLink(bot.config, `/catalogs/${catalogId}`), dict(await orgLocale(catalog.orgId)));
  await bot.api.sendMessage(catalog.telegramChatId, text, { link_preview_options: { is_disabled: true } });
}
