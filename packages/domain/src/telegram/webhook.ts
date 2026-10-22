// The bot's webhook handler: grammy's webhookCallback over createBot, with the secret-token check
// and the timeout both the web route and the API's TelegramWebhookService use. Build it once per
// process and reuse it (bot.init() runs on the first update only).
import { webhookCallback } from 'grammy';
import { createBot } from './bot';
import type { TelegramConfig } from './config';

/** Downloading and storing a large file can take a while; the audit itself runs in the background. */
export const WEBHOOK_TIMEOUT_MS = 55_000;

/**
 * `secret` is TELEGRAM_WEBHOOK_SECRET: an update without it in X-Telegram-Bot-Api-Secret-Token is
 * answered 401. After WEBHOOK_TIMEOUT_MS Telegram gets its answer while the update keeps running.
 */
export function webhookHandler<A extends 'std/http' | 'express'>(config: TelegramConfig, secret: string, adapter: A) {
  return webhookCallback(createBot(config), adapter, { secretToken: secret, timeoutMilliseconds: WEBHOOK_TIMEOUT_MS, onTimeout: 'return' });
}
