// The Telegram bot: link a chat with a one-time code, send an .xlsx/.csv,
// pick the client, get the summary when the audit finishes. The same handlers
// serve the webhook route and the long-polling dev script.
import { Bot, InlineKeyboard, type Context } from 'grammy';
import { startAudit } from '../audit-jobs.js';
import { appDict } from '../i18n-app.js';
import { gate } from '../plan.js';
import { applyMapping, mappingFor, MAX_UPLOAD_BYTES, storeCatalog } from '../catalog-import.js';
import { activeOwnedClient, defaultClient } from '../clients.js';
import { db } from '../db.js';
import { dict, type Dict } from '../i18n.js';
import { orgLocale } from '../org-locale.js';
import { parseUpload } from '../spreadsheet.js';
import type { TelegramConfig } from './config.js';
import { consumeLinkCode, linkForChat } from './linking.js';

const ACCEPTED = /\.(xlsx|csv)$/i;
const MAX_CLIENT_BUTTONS = 30;

type Link = { orgId: string; linkedBy: string };

/** The chat's language: its org admin's choice when linked, else Telegram's own setting. */
async function dictFor(ctx: Context): Promise<Dict> {
  const chatId = ctx.chat ? String(ctx.chat.id) : null;
  const link = chatId ? await linkForChat(chatId) : null;
  if (link) return dict(await orgLocale(link.orgId));
  return dict(ctx.from?.language_code === 'ru' ? 'ru' : 'uz');
}

function chatIdOf(ctx: Context): string | null {
  return ctx.chat ? String(ctx.chat.id) : null;
}

/** Downloads the file, stores it under the client and starts the audit. */
async function importFile(ctx: Context, config: TelegramConfig, link: Link, pending: { fileId: string; filename: string }, clientId: string): Promise<void> {
  const t = await dictFor(ctx);
  const chatId = chatIdOf(ctx);
  // Never into another org's client, nor into an archived one.
  const client = await activeOwnedClient(link.orgId, clientId);
  if (!chatId || !client || !config.token) {
    await ctx.reply(t.tgError);
    return;
  }
  const file = await ctx.api.getFile(pending.fileId);
  if (!file.file_path) {
    await ctx.reply(t.tgError);
    return;
  }
  const response = await fetch(`${config.apiRoot}/file/bot${config.token}/${file.file_path}`);
  if (!response.ok) {
    await ctx.reply(t.tgError);
    return;
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  // parseUpload refuses zip bombs, legacy .xls and binary files before any spreadsheet library runs.
  const parsed = await parseUpload(buffer, pending.filename).catch(() => null);
  if (!parsed) {
    await ctx.reply(t.tgError);
    return;
  }
  if (parsed.rows.length === 0) {
    await ctx.reply(t.tgEmptyFile);
    return;
  }
  const allowed = await gate(link.orgId, 'rowsPerMonth', parsed.rows.length);
  if (!allowed.ok) {
    await ctx.reply(appDict(await orgLocale(link.orgId)).msg.gate[allowed.reason]);
    return;
  }
  // No mapping screen in a chat: the client's remembered mapping, then the org's, else the header guess.
  const mapping = await mappingFor(link.orgId, parsed.headers, client.id);
  const { catalogId } = await storeCatalog({
    orgId: link.orgId, userId: link.linkedBy, clientId: client.id,
    filename: pending.filename, parsed, mapping, telegramChatId: chatId,
  });
  const applied = await applyMapping(link.orgId, catalogId, mapping);
  if ('error' in applied) {
    await ctx.reply(t.tgNoNames);
    return;
  }
  await startAudit(catalogId, { orgId: link.orgId, userId: link.linkedBy }, { via: 'telegram' });
  await ctx.reply(t.tgStarted(client.name, applied.rows));
}

export function createBot(config: TelegramConfig): Bot {
  if (!config.token) throw new Error('TELEGRAM_BOT_TOKEN is not set');
  const bot = new Bot(config.token, { client: { apiRoot: config.apiRoot } });

  bot.command('start', async (ctx) => {
    const t = await dictFor(ctx);
    const chatId = chatIdOf(ctx);
    if (!chatId) return;
    const code = typeof ctx.match === 'string' ? ctx.match.trim() : '';
    if (!code) {
      await ctx.reply((await linkForChat(chatId)) ? t.tgHelpLinked : t.tgHelp);
      return;
    }
    const outcome = await consumeLinkCode(code, chatId, ctx.from?.username ?? null);
    await ctx.reply(outcome.ok ? t.tgLinked(outcome.orgName) : outcome.reason === 'demo' ? t.tgDemo : t.tgBadCode);
  });

  bot.on('message:document', async (ctx) => {
    const t = await dictFor(ctx);
    const chatId = chatIdOf(ctx);
    const link = chatId ? await linkForChat(chatId) : null;
    if (!chatId || !link) {
      await ctx.reply(t.tgHelp);
      return;
    }
    const doc = ctx.message.document;
    const filename = doc.file_name ?? 'katalog.xlsx';
    if (!ACCEPTED.test(filename)) {
      await ctx.reply(t.tgBadType);
      return;
    }
    if ((doc.file_size ?? 0) > MAX_UPLOAD_BYTES) {
      await ctx.reply(t.tgTooBig);
      return;
    }
    // Archived clients are never offered; the default client (never archived) is the fallback.
    const active = await db.client.findMany({
      where: { orgId: link.orgId, archivedAt: null },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
      take: MAX_CLIENT_BUTTONS,
      select: { id: true, name: true },
    });
    const clients = active.length > 0 ? active : [await defaultClient(link.orgId)];
    const only = clients.length === 1 ? clients[0] : undefined;
    if (only) {
      await importFile(ctx, config, link, { fileId: doc.file_id, filename }, only.id);
      return;
    }
    const pending = await db.telegramPending.create({ data: { chatId, orgId: link.orgId, fileId: doc.file_id, filename } });
    // One button per row, no trailing empty row.
    const keyboard = InlineKeyboard.from(clients.map((c) => [InlineKeyboard.text(c.name, `c:${pending.id}:${c.id}`)]));
    await ctx.reply(t.tgChooseClient(filename), { reply_markup: keyboard });
  });

  bot.on('callback_query:data', async (ctx) => {
    const t = await dictFor(ctx);
    const [kind, pendingId, clientId] = ctx.callbackQuery.data.split(':');
    const chatId = chatIdOf(ctx);
    await ctx.answerCallbackQuery();
    if (kind !== 'c' || !pendingId || !clientId || !chatId) return;
    const link = await linkForChat(chatId);
    // The pending file must belong to this chat and its org.
    const pending = link ? await db.telegramPending.findFirst({ where: { id: pendingId, chatId, orgId: link.orgId } }) : null;
    if (!link || !pending) {
      await ctx.reply(t.tgExpired);
      return;
    }
    await db.telegramPending.delete({ where: { id: pending.id } });
    await ctx.editMessageReplyMarkup().catch(() => undefined);
    await importFile(ctx, config, link, pending, clientId);
  });

  bot.on('message', async (ctx) => {
    const t = await dictFor(ctx);
    const chatId = chatIdOf(ctx);
    await ctx.reply(chatId && (await linkForChat(chatId)) ? t.tgHelpLinked : t.tgHelp);
  });

  bot.catch((error) => {
    console.warn(`[telegram] ${error.message}`);
    void dictFor(error.ctx).then((t) => error.ctx.reply(t.tgError)).catch(() => undefined);
  });
  return bot;
}
